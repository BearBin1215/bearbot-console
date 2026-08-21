import { beforeEach, describe, test, it, expect, vi } from 'vitest';

// runner.ts 依赖 electron 等主进程模块，测试 resolveParams 时需 mock 这些模块以避免导入失败
vi.mock('electron', () => ({
  Notification: Object.assign(vi.fn(), { isSupported: vi.fn(() => false) }),
}));
vi.mock('../../electron/services/store', () => ({ getAllSettings: vi.fn(), addTaskRun: vi.fn(), getTaskConfig: vi.fn() }));
vi.mock('../../electron/services/accounts', () => ({ checkLoginAccount: vi.fn(), getApis: vi.fn(), getDefaultAccount: vi.fn(), createTaskUser: vi.fn() }));
vi.mock('../../electron/services/tasks/registry', () => ({ TASK_REGISTRY: {} }));
vi.mock('../../electron/services/moegirl', () => ({
  MoegirlRequestError: class extends Error { },
  abortSignalStorage: { run: vi.fn((_signal, callback: () => unknown) => callback()) },
  loggerStorage: { run: vi.fn((_logger, callback: () => unknown) => callback()) },
}));

import { resolveParams, formatRequestErrorDetail, runTask } from '../../electron/services/tasks/runner';
import type { RequestErrorDetail } from '../../electron/services/moegirl';
import { getAllSettings, addTaskRun, getTaskConfig } from '../../electron/services/store';
import { checkLoginAccount, getApis, getDefaultAccount, createTaskUser } from '../../electron/services/accounts';
import { TASK_REGISTRY } from '../../electron/services/tasks/registry';
import type { TaskRunCallbacks } from '../../electron/services/tasks/types';

// 测试 resolveParams 函数（合并注册表参数默认值与用户输入）
describe('resolveParams', () => {
  // 边界情况
  test('注册表内未定义 params -> 返回空对象', () => {
    expect(resolveParams(undefined, undefined)).toEqual({});
  });

  test('注册表 params 为空数组 -> 返回空对象', () => {
    expect(resolveParams([], undefined)).toEqual({});
  });

  test('用户填写空参数对象 -> 所有字段回退默认值', () => {
    expect(resolveParams(
      [{ key: 'name', label: '名称', type: 'string', default: '默认' }],
      {},
    )).toEqual({ name: '默认' });
  });

  // string 类型
  test('string - 有用户输入 -> 使用输入值', () => {
    expect(resolveParams(
      [{ key: 'name', label: '名称', type: 'string', default: '默认' }],
      { name: '自定义' },
    )).toEqual({ name: '自定义' });
  });

  test('string - 用户输入为空字符串 -> 使用默认值', () => {
    expect(resolveParams(
      [{ key: 'name', label: '名称', type: 'string', default: '默认' }],
      { name: '' },
    )).toEqual({ name: '默认' });
  });

  test('string - 无用户输入且无默认值 -> 不包含在结果中', () => {
    expect(resolveParams(
      [{ key: 'name', label: '名称', type: 'string' }],
      {},
    )).toEqual({});
  });

  // text 类型（与 string 行为一致，无专属解析逻辑）

  // number 类型
  test('number - 用户输入为数字 -> 使用该数字', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number', default: 10 }],
      { count: 42 },
    )).toEqual({ count: 42 });
  });

  test('number - 用户输入0且有非0默认值 -> 输出0', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number', default: 30 }],
      { count: 0 },
    )).toEqual({ count: 0 });
  });

  test('number - 用户输入为数字字符串 -> 转为数字', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number' }],
      { count: '15' },
    )).toEqual({ count: 15 });
  });

  test('number - 用户输入为无效字符串 -> 使用默认值', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number', default: 10 }],
      { count: 'abc' },
    )).toEqual({ count: 10 });
  });

  test('number - 用户输入为空字符串 -> 使用默认值', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number', default: 10 }],
      { count: '' },
    )).toEqual({ count: 10 });
  });

  test('number - 无用户输入且无默认值 -> 不包含在结果中', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number' }],
      {},
    )).toEqual({});
  });

  test('number - 无用户输入但有默认值 -> 使用默认值', () => {
    expect(resolveParams(
      [{ key: 'count', label: '数量', type: 'number', default: 30 }],
      {},
    )).toEqual({ count: 30 });
  });

  // multi-string 类型

  test('multi-string - 有非空数组 -> 使用该数组', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string', default: ['默认'] }],
      { tags: ['a', 'b'] },
    )).toEqual({ tags: ['a', 'b'] });
  });

  test('multi-string - 空数组 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string', default: ['默认'] }],
      { tags: [] },
    )).toEqual({ tags: ['默认'] });
  });

  test('multi-string - 数组含空项 -> 过滤空项后使用', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string', default: ['默认'] }],
      { tags: ['a', '', 'b', ''] },
    )).toEqual({ tags: ['a', 'b'] });
  });

  test('multi-string - 数组全为空项 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string', default: ['默认'] }],
      { tags: ['', ''] },
    )).toEqual({ tags: ['默认'] });
  });

  test('multi-string - 用户输入为非数组 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string', default: ['默认'] }],
      { tags: '不是数组' },
    )).toEqual({ tags: ['默认'] });
  });

  test('multi-string - 无用户输入且无默认值 -> 不包含在结果中', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string' }],
      {},
    )).toEqual({});
  });

  test('multi-string - 无用户输入但有默认值 -> 使用默认值', () => {
    expect(resolveParams(
      [{ key: 'tags', label: '标签', type: 'multi-string', default: ['x', 'y'] }],
      {},
    )).toEqual({ tags: ['x', 'y'] });
  });

  // select 单选

  test('select - 用户输入空字符串 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'mode', label: '模式', type: 'select', default: 'normal', options: [{ label: '普通', value: 'normal' }, { label: '详细', value: 'verbose' }] }],
      { mode: '' },
    )).toEqual({ mode: 'normal' });
  });

  test('select - 用户输入不在可选项中 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'mode', label: '模式', type: 'select', default: 'normal', options: [{ label: '普通', value: 'normal' }, { label: '详细', value: 'verbose' }] }],
      { mode: 'invalid' },
    )).toEqual({ mode: 'normal' });
  });

  test('select - 未声明 options -> 不过滤（原样保留）', () => {
    expect(resolveParams(
      [{ key: 'mode', label: '模式', type: 'select', default: 'normal' }],
      { mode: 'anything' },
    )).toEqual({ mode: 'anything' });
  });

  // multi-select 类型

  test('multi-select - 有非空数组 -> 使用该数组', () => {
    expect(resolveParams(
      [{ key: 'ns', label: '命名空间', type: 'multi-select', default: ['0'], options: [{ label: '主', value: '0' }, { label: '模板', value: '10' }] }],
      { ns: ['0', '10'] },
    )).toEqual({ ns: ['0', '10'] });
  });

  test('multi-select - 空数组 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'ns', label: '命名空间', type: 'multi-select', default: ['0'], options: [{ label: '主', value: '0' }, { label: '模板', value: '10' }] }],
      { ns: [] },
    )).toEqual({ ns: ['0'] });
  });

  test('multi-select - 无用户输入但有默认值 -> 使用默认值', () => {
    expect(resolveParams(
      [{ key: 'ns', label: '命名空间', type: 'multi-select', default: ['0', '10'], options: [{ label: '主', value: '0' }, { label: '模板', value: '10' }] }],
      {},
    )).toEqual({ ns: ['0', '10'] });
  });

  test('multi-select - 部分值不在可选项中 -> 过滤无效值保留有效值', () => {
    expect(resolveParams(
      [{ key: 'ns', label: '命名空间', type: 'multi-select', default: ['0'], options: [{ label: '主', value: '0' }, { label: '模板', value: '10' }] }],
      { ns: ['0', 'invalid', '10'] },
    )).toEqual({ ns: ['0', '10'] });
  });

  test('multi-select - 所有值都不在可选项中 -> 回退默认值', () => {
    expect(resolveParams(
      [{ key: 'ns', label: '命名空间', type: 'multi-select', default: ['0'], options: [{ label: '主', value: '0' }, { label: '模板', value: '10' }] }],
      { ns: ['invalid1', 'invalid2'] },
    )).toEqual({ ns: ['0'] });
  });

  // 多字段组合

  test('多字段混合：部分有用户输入、部分回退默认值、部分跳过', () => {
    expect(resolveParams(
      [
        { key: 'name', label: '名称', type: 'string', default: '默认名' },
        { key: 'count', label: '数量', type: 'number', default: 5 },
        { key: 'tags', label: '标签', type: 'multi-string', default: ['t'] },
        { key: 'optional', label: '可选', type: 'string' },
      ],
      { name: '自定义', count: 'abc' },
    )).toEqual({
      name: '自定义',
      count: 5,
      tags: ['t'],
    });
  });

  test('用户输入含注册表未声明的字段 -> 仅保留注册表声明的字段', () => {
    expect(resolveParams(
      [{ key: 'name', label: '名称', type: 'string', default: '默认' }],
      { name: '值', unknown: '应被忽略' },
    )).toEqual({ name: '值' });
  });
});


// 测试 formatRequestErrorDetail 函数（将请求错误详情格式化为可读多行文本）
describe('formatRequestErrorDetail', () => {
  /** 基础测试数据（仅必填字段） */
  const base: RequestErrorDetail = {
    method: 'POST',
    requestParams: {},
    timeout: 30000,
  };

  // 字段缺失组合
  it('仅 method（无参数/状态码/响应体）→ 单行', () => {
    expect(formatRequestErrorDetail(base)).toBe('请求：POST');
  });

  it('有参数 → 包含参数行', () => {
    const detail: RequestErrorDetail = {
      ...base,
      requestParams: { action: 'edit', title: '测试' },
    };
    const result = formatRequestErrorDetail(detail);
    expect(result).toContain('请求：POST');
    expect(result).toContain('参数：');
    expect(result).toContain('  action=edit');
    expect(result).toContain('  title=测试');
  });

  it('有状态码 → 包含 HTTP 状态行', () => {
    const detail: RequestErrorDetail = { ...base, status: 500 };
    expect(formatRequestErrorDetail(detail)).toContain('响应：HTTP 500');
  });

  it('有响应体 → 包含响应体', () => {
    const detail: RequestErrorDetail = { ...base, responseBody: '{"error":"xxx"}' };
    const result = formatRequestErrorDetail(detail);
    expect(result).toContain('响应体：');
    expect(result).toContain('{"error":"xxx"}');
  });

  // 完整组合

  it('全部字段都有 → 完整多行格式', () => {
    const detail: RequestErrorDetail = {
      method: 'GET',
      requestParams: { action: 'query' },
      status: 200,
      responseBody: 'OK',
      timeout: 30000,
    };
    expect(formatRequestErrorDetail(detail)).toBe([
      '请求：GET',
      '参数：',
      '  action=query',
      '响应：HTTP 200',
      '响应体：',
      'OK',
    ].join('\n'));
  });

  // 边界情况

  it('参数为空对象 → 不包含参数行', () => {
    expect(formatRequestErrorDetail(base)).not.toContain('参数：');
  });

  it('状态码为 0 → 仍包含 HTTP 状态行（0 !== undefined）', () => {
    const detail: RequestErrorDetail = { ...base, status: 0 };
    expect(formatRequestErrorDetail(detail)).toContain('响应：HTTP 0');
  });

  it('响应体为空字符串 → 仍包含响应体行（"" !== undefined）', () => {
    const detail: RequestErrorDetail = { ...base, responseBody: '' };
    const result = formatRequestErrorDetail(detail);
    expect(result).toContain('响应体：');
  });
});

// 测试 runTask 的任务级锁（必须覆盖账号登录检查这一首次异步等待）
describe('runTask concurrency', () => {
  /** 构造可手动完成的 Promise，用于稳定复现登录检查期间的并发触发 */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** 任务执行回调测试替身 */
  const callbacks: TaskRunCallbacks = {
    sendLog: vi.fn(),
    sendStatus: vi.fn(),
    sendRunRecord: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(TASK_REGISTRY)) {
      delete TASK_REGISTRY[key];
    }
    vi.mocked(getTaskConfig).mockReturnValue({ cron: '', enabled: false, accountId: 'account-1' });
    vi.mocked(getDefaultAccount).mockReturnValue(undefined);
    vi.mocked(getApis).mockReturnValue({ api: {} as never, commonsApi: {} as never });
    vi.mocked(createTaskUser).mockReturnValue({
      getId: () => '1',
      getUser: () => 'Tester',
      getRights: async () => [],
      getGroups: async () => [],
    });
    vi.mocked(getAllSettings).mockReturnValue({ notifyOnTaskComplete: false } as never);
  });

  it('账号登录检查尚未完成时，第二次触发立即被拒绝', async () => {
    const login = deferred<{ username: string; userId: string } | null>();
    const handler = vi.fn(async () => {});
    TASK_REGISTRY.taskA = { defaultName: '任务A', handler };
    vi.mocked(checkLoginAccount).mockReturnValue(login.promise);

    const firstRun = runTask('taskA', callbacks);
    const secondResult = await runTask('taskA', callbacks);

    expect(secondResult).toEqual({ success: false, error: '任务正在执行中，已忽略本次触发' });
    expect(checkLoginAccount).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();

    login.resolve({ username: 'Tester', userId: '1' });
    await expect(firstRun).resolves.toEqual({ success: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(addTaskRun).toHaveBeenCalledTimes(1);
  });

  it('账号检查抛错后释放任务锁，后续触发可以执行', async () => {
    const handler = vi.fn(async () => {});
    TASK_REGISTRY.taskA = { defaultName: '任务A', handler };
    vi.mocked(checkLoginAccount)
      .mockRejectedValueOnce(new Error('cookie store unavailable'))
      .mockResolvedValueOnce({ username: 'Tester', userId: '1' });

    await expect(runTask('taskA', callbacks)).rejects.toThrow('cookie store unavailable');
    await expect(runTask('taskA', callbacks)).resolves.toEqual({ success: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
