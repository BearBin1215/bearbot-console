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
import { bodyLimit } from 'hono/body-limit';
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

/** Webhook 服务监听配置（地址 + 端口）；开关关闭时不存在 */
interface WebhookTarget {
  /** 监听地址 */
  host: string;
  /** 监听端口 */
  port: number;
}

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

/** 请求体大小上限（1MB）：请求体仅含 params/wait 两个小字段，正常不会超出 */
const WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;

/** 启动失败后的重试冷却时长：相同配置在冷却期内不再重试，避免端口占用时每次设置保存都重复启动并刷错误日志 */
const START_RETRY_COOLDOWN_MS = 5000;

/**
 * Webhook 服务管理器
 *
 * 与 TaskScheduler 同构：都是任务的"触发源"，实际执行统一交给 runner 的 runTask，
 * 天然复用防重入锁、取消信号、日志推送与执行记录。
 */
class WebhookServer {
  /** 当前运行中的 HTTP 服务实例与其监听地址；未运行时为 null */
  private running: { server: ServerType; target: WebhookTarget } | null = null;
  /** 上次启动失败的配置与时间，冷却期内相同配置不再重试 */
  private lastFailed: { target: WebhookTarget; at: number } | null = null;
  /** 在途的 applySettings/stop 操作链（promise 链串行化，消除并发调用导致的重复监听泄漏） */
  private pending: Promise<void> = Promise.resolve();
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
    .use('/webhook/*', bodyLimit({ maxSize: WEBHOOK_BODY_LIMIT_BYTES }))
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
   * 按设置应用服务状态：开关关闭时停止，配置变化时重启，未变化时跳过
   *
   * 渲染进程 persist 每次设置变更都会触发，端口连续输入等场景会产生并发调用；
   * 不串行化时第二次调用会在第一次的 stop/start 间隙误判"未运行"，导致重复监听泄漏。
   * @param settings 应用后的完整设置（只使用 webhook 相关三字段）
   */
  applySettings(settings: SettingsData): Promise<void> {
    const { webhookEnabled: enabled, webhookHost: host, webhookPort: port } = settings;
    // 入队前先隔离链上历史错误，避免前序 rejection 使后续回调被永久跳过；
    // 本次操作错误仍通过 run 向调用方传播，但不再污染链（链上以吞错副本为准）
    const run = this.pending.catch(() => {}).then(() => this.applySettingsSerial(enabled, { host, port }));
    this.pending = run.catch(() => {});
    return run;
  }

  /**
   * 实际应用逻辑；仅由 {@link applySettings} 在串行链上调用（内部直接调私有 stopSerial，避免向自身链重复入队造成循环等待）
   *
   * 相同配置在启动失败冷却期内跳过重试，
   * 冷却期过后或配置变化时允许重试（用户关闭占用端口的进程后无需重启应用即可恢复）。
   */
  private async applySettingsSerial(enabled: boolean, target: WebhookTarget): Promise<void> {
    if (!enabled) {
      await this.stopSerial();
      // 主动关闭视为有意操作：清除失败记录，之后重新开启时立即重试而非等待冷却期
      this.lastFailed = null;
      return;
    }
    if (this.running && this.running.target.host === target.host && this.running.target.port === target.port) {
      return;
    }
    if (this.lastFailed && this.lastFailed.target.host === target.host && this.lastFailed.target.port === target.port) {
      if (Date.now() - this.lastFailed.at < START_RETRY_COOLDOWN_MS) {
        return;
      }
    }
    await this.stopSerial();
    await this.start(target);
  }

  /** 启动 HTTP 服务；token 为空时先生成随机 token 持久化（渲染进程随后通过 settings:get 读到） */
  private async start(target: WebhookTarget): Promise<void> {
    const { host, port } = target;
    try {
      // 兜底：正常路径下渲染进程开启开关时已生成 token 并随设置写入；
      // 直接修改配置文件等旁路场景到达此处时才生成，保证服务可用（渲染进程 UI 需手动重新生成对齐）
      if (!getAllSettings().webhookToken) {
        patchSettings({ webhookToken: generateToken() });
      }
      const server = serve({ fetch: this.app.fetch, port, hostname: host });
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      // 启动成功后清除失败记录，避免冷却期判断依赖过期的失败配置
      this.lastFailed = null;
      this.running = { server, target };
      this.log('INFO', `Webhook 服务已启动：http://${host}:${port}`);
    } catch (err) {
      // 启动失败（端口占用、token 兜底写盘失败等）仅记录日志，不影响应用其余功能（调度、手动执行照常）
      this.log('ERROR', `Webhook 服务启动失败（${host}:${port}）：${(err as Error)?.message ?? String(err)}`);
      // 记录失败配置与时间
      this.lastFailed = { target, at: Date.now() };
    }
  }

  /**
   * 停止服务；未运行时为空操作（同样加入串行链，与在途的 applySettings 顺序执行）
   *
   * close 前先强制断开全部连接：wait=true 的同步请求可持续数分钟且 undici 默认
   * keep-alive 复用连接，仅 close() 会等待其自然结束导致端口切换长时间阻塞。
   */
  stop(): Promise<void> {
    // 同 applySettings：隔离链上历史错误，避免前序 rejection 卡死后续操作
    const run = this.pending.catch(() => {}).then(() => this.stopSerial());
    this.pending = run.catch(() => {});
    return run;
  }

  /** 实际停止逻辑；仅由 {@link stop} 在串行链上调用 */
  private async stopSerial(): Promise<void> {
    if (!this.running) {
      return;
    }
    const { server, target } = this.running;
    const stoppedAt = `${target.host}:${target.port}`;
    this.running = null;
    // ServerType 联合类型含 Http2Server（无此方法），HTTP/1.1 server 才有；in 收窄后调用
    if ('closeAllConnections' in server) {
      server.closeAllConnections();
    }
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
