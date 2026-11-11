import { describe, it, expect, vi, beforeEach } from 'vitest';

// moegirl.ts 顶部 import getAllSettings，触发 electron-store 实例化；mock 以避免磁盘副作用
vi.mock('../../electron/services/store', () => ({
  getAllSettings: vi.fn(),
}));

import { MoegirlApi, MoegirlRequestError, type RequestErrorDetail } from '../../electron/services/moegirl';
import { getAllSettings } from '../../electron/services/store';
import { createDefaultSettings } from '../../shared/settings';

// 测试 MoegirlRequestError 构造函数（结构化请求错误的消息拼接、超时识别、详情携带）
describe('MoegirlRequestError', () => {
  /** 基础测试详情（仅必填字段） */
  const baseDetail: RequestErrorDetail = {
    method: 'POST',
    requestParams: { action: 'edit' },
    timeout: 30000,
  };

  // #region 基本消息拼接

  it('普通错误 → 拼接 method/action/error.message', () => {
    const err = new MoegirlRequestError(new Error('boom'), 'edit', 0, baseDetail);
    expect(err.message).toBe('POST 请求失败，action=edit，boom');
  });

  it('attempt 为 0 → 不附加重试信息', () => {
    const err = new MoegirlRequestError(new Error('fail'), 'edit', 0, baseDetail);
    expect(err.message).not.toContain('已重试');
  });

  it('attempt > 0 → 附加"已重试N次"', () => {
    const err = new MoegirlRequestError(new Error('fail'), 'edit', 3, baseDetail);
    expect(err.message).toContain('已重试3次');
  });

  // #endregion


  // #region 超时识别（isTimeout 分支）

  it('error.name 为 AbortError → 识别为超时并显示秒数', () => {
    const cause = new DOMException('Aborted', 'AbortError');
    const detail: RequestErrorDetail = { ...baseDetail, method: 'GET', timeout: 45000 };
    const err = new MoegirlRequestError(cause, 'query', 0, detail);
    // parts: ['GET 请求失败', 'action=query', '请求超时（45s）']
    expect(err.message).toBe('GET 请求失败，action=query，请求超时（45s）');
  });

  it('error.message 包含 "aborted" → 识别为超时（大小写不敏感）', () => {
    const err = new MoegirlRequestError(
      new Error('The operation was aborted'),
      'query',
      0,
      { ...baseDetail, method: 'GET', timeout: 30000 },
    );
    expect(err.message).toContain('请求超时（30s）');
    // 错误原文 "aborted" 不应出现（被替换为超时描述）
    expect(err.message).not.toContain('aborted');
  });

  it('error.name 非 AbortError 且 message 不含 "aborted" → 不识别为超时', () => {
    const err = new MoegirlRequestError(new Error('Network Error'), 'query', 0, baseDetail);
    expect(err.message).not.toContain('请求超时');
    expect(err.message).toContain('Network Error');
  });

  // #endregion


  // #region 完整组合

  it('超时 + 已重试 → 同时显示超时与重试信息', () => {
    const cause = new DOMException('Aborted', 'AbortError');
    const err = new MoegirlRequestError(cause, 'query', 2, { ...baseDetail, method: 'POST', timeout: 60000 });
    expect(err.message).toBe('POST 请求失败，action=query，请求超时（60s），已重试2次');
  });

  // #endregion


  // #region 属性赋值

  it('name 属性为 "MoegirlRequestError"', () => {
    const err = new MoegirlRequestError(new Error('x'), 'y', 0, baseDetail);
    expect(err.name).toBe('MoegirlRequestError');
  });

  it('cause 传递原始错误对象', () => {
    const cause = new Error('origin');
    const err = new MoegirlRequestError(cause, 'edit', 0, baseDetail);
    expect(err.cause).toBe(cause);
  });

  it('detail 属性按引用赋值（携带完整请求/响应详情）', () => {
    const detail: RequestErrorDetail = {
      method: 'POST',
      requestParams: { action: 'edit', title: 'X' },
      status: 500,
      responseBody: 'err',
      timeout: 30000,
    };
    const err = new MoegirlRequestError(new Error('fail'), 'edit', 1, detail);
    expect(err.detail).toBe(detail);
    expect(err.detail.status).toBe(500);
  });

  // #endregion


  // #region 继承关系

  it('继承 Error 与 MoegirlRequestError', () => {
    const err = new MoegirlRequestError(new Error('x'), 'y', 0, baseDetail);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MoegirlRequestError);
  });

  // #endregion
});


// #region token 失效处理

/** 构造仅实现 fetch 的 session 桩，按调用顺序消费预设响应并记录请求参数 */
function createSession(responses: Array<() => unknown>) {
  /** 每次请求的地址与初始化参数 */
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const responder = responses.shift();
    if (!responder) {
      throw new Error('测试未预设对应的请求响应');
    }
    const body = JSON.stringify(responder());
    return { ok: true, status: 200, text: async () => body };
  });
  return { fetch, calls };
}

/** 读取请求体中指定参数的值（仅用于 POST 的 URLSearchParams body） */
function getBodyParam(init: RequestInit, key: string): string | null {
  return new URLSearchParams(init.body as string).get(key);
}

describe('MoegirlApi token 失效处理', () => {
  beforeEach(() => {
    vi.mocked(getAllSettings).mockReturnValue({
      ...createDefaultSettings('test'),
      retryCount: 2,
      retryInterval: 0,
      minRequestInterval: 0,
    });
  });

  it('badtoken → 刷新 token 后用新 token 重试', async () => {
    const { fetch, calls } = createSession([
      () => ({ query: { tokens: { csrftoken: 'stale' } } }),
      () => ({ error: { code: 'badtoken', info: 'Invalid CSRF token.' } }),
      () => ({ query: { tokens: { csrftoken: 'fresh' } } }),
      () => ({ edit: { result: 'Success' } }),
    ]);
    const api = new MoegirlApi({ fetch } as unknown as ConstructorParameters<typeof MoegirlApi>[0]);

    await expect(api.postWithToken('csrf', { action: 'edit', title: 'X', text: 'Y' }))
      .resolves.toEqual({ edit: { result: 'Success' } });

    // 取 token → 失败 → 刷新 token → 重试成功；badtoken 不进入请求级重试
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(getBodyParam(calls[1].init, 'token')).toBe('stale');
    expect(getBodyParam(calls[3].init, 'token')).toBe('fresh');
  });

  it('刷新后仍 badtoken → 直接抛出，不无限刷新', async () => {
    const { fetch } = createSession([
      () => ({ query: { tokens: { csrftoken: 'stale' } } }),
      () => ({ error: { code: 'badtoken', info: 'Invalid CSRF token.' } }),
      () => ({ query: { tokens: { csrftoken: 'fresh' } } }),
      () => ({ error: { code: 'badtoken', info: 'Invalid CSRF token.' } }),
    ]);
    const api = new MoegirlApi({ fetch } as unknown as ConstructorParameters<typeof MoegirlApi>[0]);

    const error = await api.postWithToken('csrf', { action: 'edit' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MoegirlRequestError);
    expect((error as MoegirlRequestError).code).toBe('badtoken');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('不可重试错误码按 code 判断，不依赖 info 文案', async () => {
    const { fetch } = createSession([
      () => ({ error: { code: 'permissiondenied', info: 'You do not have permission to do that.' } }),
    ]);
    const api = new MoegirlApi({ fetch } as unknown as ConstructorParameters<typeof MoegirlApi>[0]);

    const error = await api.post({ action: 'query' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MoegirlRequestError);
    expect((error as MoegirlRequestError).code).toBe('permissiondenied');
    // retryCount 为 2，但该错误码不可重试，只应发出一次请求
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// #endregion
