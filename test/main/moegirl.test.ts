import { describe, it, expect, vi } from 'vitest';

// moegirl.ts 顶部 import getAllSettings，触发 electron-store 实例化；mock 以避免磁盘副作用
vi.mock('../../electron/services/store', () => ({
  getAllSettings: vi.fn(),
}));

import { MoegirlRequestError, type RequestErrorDetail } from '../../electron/services/moegirl';

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
