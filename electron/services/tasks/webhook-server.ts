/**
 * Webhook 触发服务
 *
 * 在主进程内启动 HTTP 服务，收到携带 Bearer Token 鉴权的请求时触发指定任务：
 * - `GET /health` 健康检查（无鉴权，仅返回存活状态）
 * - `POST /webhook/:taskKey` 触发任务，请求体 `{ params?, wait? }`：
 *   params 为临时参数覆盖值（优先级高于任务已保存配置），wait=true 时同步等待执行结果
 *
 * 生命周期：主进程启动时按设置拉起，设置变更（开关/地址/端口）时由 IPC 处理器
 * 调用 applySettings 增量调整（地址或端口变化时重启），应用退出时调用 stop 清理。
 */
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { serve, type ServerType } from '@hono/node-server';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SettingsData } from '@shared/types';
import { getAllSettings, patchSettings, getTaskConfig } from '../store';
import { TASK_REGISTRY } from './registry';
import { runTask } from './runner';
import type { TaskRunCallbacks } from './types';

/** webhook 请求体 schema：params 覆盖任务参数（仅注册表声明字段生效），wait 控制是否同步等待结果 */
const webhookBodySchema = z.object({
  params: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.array(z.string())]),
  ).optional(),
  wait: z.boolean().optional(),
});

/** 生成随机 Webhook Token（24 字节熵，base64url 编码） */
function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/** 常数时间比较两个 token，避免时序攻击泄露前缀 */
function tokenEquals(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook 服务管理器
 *
 * 与 TaskScheduler 同构：都是任务的"触发源"，实际执行统一交给 runner 的 runTask，
 * 天然复用防重入锁、取消信号、日志推送与执行记录。
 */
class WebhookServer {
  /** 当前运行中的 HTTP 服务实例 */
  private server: ServerType | null = null;
  /** 已成功应用的服务配置（地址 + 端口），用于判断设置变化是否需要重启 */
  private appliedHost: string | null = null;
  private appliedPort: number | null = null;
  /** 推送回调集合（日志、状态、执行记录），由主进程注入 */
  private callbacks: TaskRunCallbacks | null = null;

  /** Hono 应用实例；鉴权与任务解析均在请求时动态读取，Token 重新生成后无需重启即生效 */
  private app = new Hono()
    // Bearer Token 鉴权：仅 /webhook/* 路径需要，/health 保持无鉴权
    .use('/webhook/*', bearerAuth({
      verifyToken: (token) => {
        const expected = getAllSettings().webhookToken;
        return expected !== '' && tokenEquals(token, expected);
      },
    }))
    .get('/health', (c) => c.json({ status: 'ok' }))
    .post('/webhook/:taskKey', async (c) => {
      const taskKey = c.req.param('taskKey');
      // 任务必须在注册表中且显式开启 webhook 触发；未开启时与不存在同样返回 404，不暴露任务存在性
      if (!TASK_REGISTRY[taskKey] || !getTaskConfig(taskKey)?.webhookEnabled) {
        return c.json({ error: '任务不存在或未开放 Webhook 触发' }, 404);
      }

      // 解析请求体；空 body 视为无覆盖参数的纯触发
      let body: z.infer<typeof webhookBodySchema> = {};
      const raw = await c.req.text();
      if (raw) {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch {
          return c.json({ error: '请求体不是合法的 JSON' }, 400);
        }
        const parsed = webhookBodySchema.safeParse(parsedJson);
        if (!parsed.success) {
          return c.json({ error: '请求体格式无效' }, 400);
        }
        body = parsed.data;
      }

      const callbacks = this.callbacks;
      if (!callbacks) {
        return c.json({ error: '服务未就绪' }, 503);
      }
      callbacks.sendLog({
        level: 'INFO',
        taskKey,
        message: '收到 Webhook 触发请求',
        system: true,
      });

      if (body.wait) {
        // 同步模式：等待任务执行结束并返回结果（复用 runTask 的防重入，冲突时返回 success: false）
        const result = await runTask(taskKey, callbacks, body.params);
        return c.json(result, 200);
      }
      // 异步模式：立即返回 202，任务后台执行；rejection（如登录检查抛错）记录系统日志
      runTask(taskKey, callbacks, body.params).catch((err) => {
        callbacks.sendLog({
          level: 'ERROR',
          taskKey,
          message: `Webhook 触发执行失败：${(err as Error)?.message ?? String(err)}`,
          system: true,
        });
      });
      return c.json({ accepted: true }, 202);
    });

  /** 设置推送回调集合 */
  setCallbacks(callbacks: TaskRunCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 按设置应用服务状态：
   * - 未启用：停止服务
   * - 已启用且未运行或地址/端口变化：重启
   * - 已启用且配置未变：跳过（避免设置面板其他字段保存时反复重启）
   */
  async applySettings(settings: SettingsData): Promise<void> {
    const { webhookEnabled: enabled, webhookHost: host, webhookPort: port } = settings;
    if (!enabled) {
      await this.stop();
      return;
    }
    if (this.server && this.appliedHost === host && this.appliedPort === port) {
      return;
    }
    await this.stop();
    await this.start(host, port);
  }

  /** 启动 HTTP 服务；token 为空时先生成随机 token 持久化（渲染进程随后通过 settings:get 读到） */
  private async start(host: string, port: number): Promise<void> {
    // 空 token 会让所有请求鉴权失败，启动前兜底生成
    if (!getAllSettings().webhookToken) {
      patchSettings({ webhookToken: generateToken() });
    }
    try {
      const server = serve({ fetch: this.app.fetch, port, hostname: host });
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      this.server = server;
      this.appliedHost = host;
      this.appliedPort = port;
      this.log('INFO', `Webhook 服务已启动：http://${host}:${port}`);
    } catch (err) {
      // 端口占用等启动失败仅记录日志，不影响应用其余功能（调度、手动执行照常）
      this.log('ERROR', `Webhook 服务启动失败（${host}:${port}）：${(err as Error)?.message ?? String(err)}`);
    }
  }

  /** 停止服务；未运行时为空操作 */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    // 先记录本次监听地址再清空状态，供停止日志输出
    const stoppedAt = `${this.appliedHost}:${this.appliedPort}`;
    this.server = null;
    this.appliedHost = null;
    this.appliedPort = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.log('INFO', `Webhook 服务已停止（${stoppedAt}）`);
  }

  /** 发送 Webhook 服务的系统日志（复用任务日志通道，taskKey 固定系统标识） */
  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    this.callbacks?.sendLog({ level, taskKey: '__system__', message, system: true });
  }
}

/** Webhook 服务管理器单例 */
export const webhookServer = new WebhookServer();

/** 重新生成 Webhook Token 并持久化；新 token 通过请求时动态读取立即生效（供 IPC webhook:regenerate-token 调用） */
export function regenerateWebhookToken(): string {
  const token = generateToken();
  patchSettings({ webhookToken: token });
  return token;
}
