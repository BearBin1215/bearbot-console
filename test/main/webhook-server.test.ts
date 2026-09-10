import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// webhook-server 的依赖链含 electron-store / runner（间接依赖 electron），测试前 mock 掉这些模块
vi.mock('../../electron/services/store', () => ({
  getAllSettings: vi.fn(),
  patchSettings: vi.fn(),
  getTaskConfig: vi.fn(),
}));
vi.mock('../../electron/services/tasks/registry', () => ({ TASK_REGISTRY: {} }));
vi.mock('../../electron/services/tasks/runner', () => ({ runTask: vi.fn() }));

import type { SettingsData } from '@shared/types';
import { webhookServer, regenerateWebhookToken } from '../../electron/services/tasks/webhook-server';
import { getAllSettings, patchSettings, getTaskConfig } from '../../electron/services/store';
import { TASK_REGISTRY } from '../../electron/services/tasks/registry';
import { runTask } from '../../electron/services/tasks/runner';
import type { TaskRunCallbacks } from '../../electron/services/tasks/types';

/** 测试用回调集合（记录日志用于断言） */
const callbacks: TaskRunCallbacks = {
  sendLog: vi.fn(),
  sendStatus: vi.fn(),
  sendRunRecord: vi.fn(),
};

/** 构造 Webhook 相关设置（其余字段仅满足类型） */
function makeSettings(overrides: Partial<SettingsData> = {}): SettingsData {
  return {
    webhookEnabled: true,
    webhookHost: '127.0.0.1',
    webhookPort: 0,
    webhookToken: 'test-token',
    ...overrides,
  } as SettingsData;
}

/** 随机高位端口，降低并行测试端口冲突概率 */
const PORT = 20000 + Math.floor(Math.random() * 20000);

describe('webhookServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookServer.setCallbacks(callbacks);
    // 默认：token 已配置、任务 taskA 已注册且开启 webhook 触发
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookPort: PORT }));
    vi.mocked(getTaskConfig).mockReturnValue({ cron: '', enabled: false, webhookEnabled: true });
    TASK_REGISTRY.taskA = { defaultName: '任务A', handler: vi.fn() };
  });

  afterEach(async () => {
    await webhookServer.stop();
    delete TASK_REGISTRY.taskA;
  });

  it('未启用时 applySettings 不启动服务', async () => {
    await webhookServer.applySettings(makeSettings({ webhookEnabled: false, webhookPort: PORT }));
    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
  });

  it('启用后 /health 返回存活状态（无需鉴权）', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('停止服务时输出系统日志（含监听地址）', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    await webhookServer.stop();
    expect(callbacks.sendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'INFO',
        taskKey: '__system__',
        system: true,
        message: `Webhook 服务已停止（127.0.0.1:${PORT}）`,
      }),
    );
  });

  it('Token 为空时启动服务前自动生成并持久化（生成的 Token 可用于鉴权）', async () => {
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookToken: '', webhookPort: PORT }));
    vi.mocked(runTask).mockResolvedValue({ success: true });
    await webhookServer.applySettings(makeSettings({ webhookToken: '', webhookPort: PORT }));
    expect(patchSettings).toHaveBeenCalledWith({ webhookToken: expect.any(String) });
    // 写入的 token 即为后续请求的鉴权值：以写入值为准验证 bearerAuth 链路可用
    const generated = vi.mocked(patchSettings).mock.calls.at(-1)?.[0].webhookToken ?? '';
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookToken: generated, webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${generated}` },
    });
    expect(res.status).toBe(202);
    expect(runTask).toHaveBeenCalledWith('taskA', callbacks, undefined);
  });

  it('缺少或错误的 Authorization 头返回 401', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const noAuth = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, { method: 'POST' });
    expect(noAuth.status).toBe(401);
    const badAuth = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(badAuth.status).toBe(401);
  });

  it('任务不存在或未开放 Webhook 触发返回 404', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    // 未注册任务
    const unknown = await fetch(`http://127.0.0.1:${PORT}/webhook/nope`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(unknown.status).toBe(404);
    // 已注册但任务配置未开启 webhookEnabled
    vi.mocked(getTaskConfig).mockReturnValue({ cron: '', enabled: false });
    const disabled = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(disabled.status).toBe(404);
  });

  it('请求体不是合法 JSON 返回 400', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('异步模式（默认）：返回 202 并以请求体 params 覆盖触发任务', async () => {
    vi.mocked(runTask).mockResolvedValue({ success: true });
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { greeting: '世界' } }),
    });
    expect(res.status).toBe(202);
    expect(runTask).toHaveBeenCalledWith('taskA', callbacks, { greeting: '世界' });
  });

  it('wait=true：同步等待任务结果并返回 200', async () => {
    vi.mocked(runTask).mockResolvedValue({ success: false, error: '任务正在执行中，已忽略本次触发' });
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ wait: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, error: '任务正在执行中，已忽略本次触发' });
  });

  it('空请求体：仅触发任务不覆盖参数', async () => {
    vi.mocked(runTask).mockResolvedValue({ success: true });
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(202);
    expect(runTask).toHaveBeenCalledWith('taskA', callbacks, undefined);
  });

  it('超过大小上限的请求体返回 413', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const res = await fetch(`http://127.0.0.1:${PORT}/webhook/taskA`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      // 构造超过 1MB 上限的请求体
      body: JSON.stringify({ params: { pad: 'x'.repeat(2 * 1024 * 1024) } }),
    });
    expect(res.status).toBe(413);
    expect(runTask).not.toHaveBeenCalled();
  });

  it('token 兜底写盘失败仅记录日志，不污染 promise 链', async () => {
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookToken: '', webhookPort: PORT }));
    vi.mocked(patchSettings).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(webhookServer.applySettings(makeSettings({ webhookPort: PORT }))).resolves.toBeUndefined();

    expect(callbacks.sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ERROR', message: expect.stringContaining('启动失败') }),
    );
    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
    // 链未被污染：后续设置变更仍正常应用并启动服务
    const NEW_PORT = PORT + 2;
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookPort: NEW_PORT }));
    await webhookServer.applySettings(makeSettings({ webhookPort: NEW_PORT }));
    expect((await fetch(`http://127.0.0.1:${NEW_PORT}/health`)).status).toBe(200);
  });

  it('并发 applySettings 被串行化，不产生重复监听', async () => {
    // 模拟端口连续输入：两次设置变更几乎同时到达（第二次在第一次的 stop/start 间隙）
    const P1 = PORT;
    const P2 = PORT + 1;
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookPort: P1 }));
    // 并发发起，不 await 第一个
    const first = webhookServer.applySettings(makeSettings({ webhookPort: P1 }));
    const second = webhookServer.applySettings(makeSettings({ webhookPort: P2 }));
    await Promise.all([first, second]);
    // 最终只有一个端口存活（后应用的 P2）
    await expect(fetch(`http://127.0.0.1:${P1}/health`)).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${P2}/health`);
    expect(res.status).toBe(200);
  });

  it('地址或端口变化时重启服务', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    const oldServerPort = PORT;
    const NEW_PORT = PORT + 1;
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookPort: NEW_PORT }));
    await webhookServer.applySettings(makeSettings({ webhookPort: NEW_PORT }));
    // 旧端口不再监听
    await expect(fetch(`http://127.0.0.1:${oldServerPort}/health`)).rejects.toThrow();
    // 新端口可访问
    const res = await fetch(`http://127.0.0.1:${NEW_PORT}/health`);
    expect(res.status).toBe(200);
  });

  it('监听地址切换（127.0.0.1 -> 0.0.0.0）时重启服务', async () => {
    await webhookServer.applySettings(makeSettings({ webhookPort: PORT }));
    vi.mocked(getAllSettings).mockReturnValue(makeSettings({ webhookHost: '0.0.0.0', webhookPort: PORT }));
    await webhookServer.applySettings(makeSettings({ webhookHost: '0.0.0.0', webhookPort: PORT }));
    // 0.0.0.0 覆盖全部网卡，127.0.0.1 仍可达，且切换后服务重新监听
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.status).toBe(200);
  });

  it('regenerateWebhookToken 生成随机 Token 并持久化', () => {
    const token = regenerateWebhookToken();
    expect(patchSettings).toHaveBeenCalledWith({ webhookToken: token });
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
