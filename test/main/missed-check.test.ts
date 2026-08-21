import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cron } from 'croner';
import type { TaskConfig, TaskRunRecord } from '@shared/types';

// missed-check 依赖 store/registry/runner 等主进程模块，mock 以隔离 cron 比对纯逻辑
vi.mock('../../electron/services/store', () => ({
  getTaskConfigStore: vi.fn(),
  getAllTaskRuns: vi.fn(),
  getLastAliveAt: vi.fn(),
}));
vi.mock('../../electron/services/tasks/registry', () => ({
  TASK_REGISTRY: {} as Record<string, { defaultName: string }>,
}));
vi.mock('../../electron/services/tasks/runner', () => ({
  getRunningTasks: vi.fn(),
}));

import { getMissedTaskRuns } from '../../electron/services/tasks/missed-check';
import { getTaskConfigStore, getAllTaskRuns, getLastAliveAt } from '../../electron/services/store';
import { TASK_REGISTRY } from '../../electron/services/tasks/registry';
import { getRunningTasks } from '../../electron/services/tasks/runner';

/**
 * 固定测试时间（本地 10:30:30）
 *
 * 分钟 30 距整点 30 分（超过 60s 容差），秒 30 距整分 30 秒（不足 60s 容差），
 * 用本地时间构造以保证分秒值与时区无关。
 */
const NOW_DATE = new Date(2026, 0, 15, 10, 30, 30);
const NOW = NOW_DATE.getTime();

/** 计算指定 cron 在 NOW 之前最近一次预期触发时间（与实现使用相同的 croner） */
function prevTime(cron: string): number {
  return new Cron(cron, { paused: true }).previousRuns(1, new Date(NOW))[0].getTime();
}

/** 在注册表中注册任务（仅 defaultName，missed-check 仅用到此字段） */
function registerTask(key: string, defaultName: string): void {
  (TASK_REGISTRY as Record<string, { defaultName: string }>)[key] = { defaultName };
}

/** 设置任务配置集合 */
function setConfigs(configs: Record<string, TaskConfig>): void {
  vi.mocked(getTaskConfigStore).mockReturnValue({ order: [], configs });
}

/** 设置任务执行记录 */
function setRuns(runs: TaskRunRecord[]): void {
  vi.mocked(getAllTaskRuns).mockReturnValue(runs);
}

/** 设置正在运行的任务 key 列表 */
function setRunning(keys: string[]): void {
  vi.mocked(getRunningTasks).mockReturnValue(keys);
}

/** 设置应用最后存活时间 */
function setLastAliveAt(t: number): void {
  vi.mocked(getLastAliveAt).mockReturnValue(t);
}

// 测试 getMissedTaskRuns 函数（检查启用任务在关闭期间错过的预期执行）
describe('getMissedTaskRuns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_DATE);
    vi.resetAllMocks();
    // 清空注册表（resetAllMocks 不影响普通对象属性，需手动清）
    for (const key of Object.keys(TASK_REGISTRY)) {
      delete (TASK_REGISTRY as Record<string, unknown>)[key];
    }
    // 默认空返回值
    setConfigs({});
    setRuns([]);
    setRunning([]);
    // 默认无存活记录（0），不影响已有执行记录的任务判定
    setLastAliveAt(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });


  // #region 跳过条件

  it('任务未启用 -> 跳过', () => {
    registerTask('taskA', '任务A');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: false } });
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('任务无 cron -> 跳过', () => {
    registerTask('taskA', '任务A');
    setConfigs({ taskA: { cron: '', enabled: true } });
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('任务不在注册表 -> 跳过', () => {
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('任务正在运行 -> 跳过', () => {
    registerTask('taskA', '任务A');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setRunning(['taskA']);
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('cron 无效 -> 跳过', () => {
    registerTask('taskA', '任务A');
    setConfigs({ taskA: { cron: 'invalid-cron', enabled: true } });
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('距 now 不足容差（60s）-> 跳过', () => {
    registerTask('taskA', '任务A');
    // * * * * * 每分钟，prev 为当前分钟 0 秒，距 now（30 秒）不足 60s 容差
    setConfigs({ taskA: { cron: '* * * * *', enabled: true } });
    expect(getMissedTaskRuns()).toEqual([]);
  });

  // #endregion


  // #region 错过判定

  it('从未执行且预期触发晚于应用最后存活时间 -> 错过', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    // 最后存活时间早于预期触发：触发时应用确定未运行，属于关闭期间错过
    setLastAliveAt(expected - 60000);
    expect(getMissedTaskRuns()).toEqual([{
      taskKey: 'taskA',
      taskName: '任务A',
      lastExpectedTime: expected,
      lastRunTime: null,
    }]);
  });

  it('从未执行且预期触发早于应用最后存活时间 -> 跳过', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    // 最后存活时间晚于预期触发：触发时应用可能在运行、任务可能尚未配置，保守跳过
    setLastAliveAt(expected + 60000);
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('从未执行且预期触发等于应用最后存活时间 -> 跳过（<= 边界）', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setLastAliveAt(expected);
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('上次执行早于预期触发 -> 错过', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setRuns([{ taskKey: 'taskA', startTime: expected - 120000, endTime: expected - 60000, success: true }]);
    const result = getMissedTaskRuns();
    expect(result).toHaveLength(1);
    expect(result[0].lastRunTime).toBe(expected - 60000);
  });

  it('上次执行晚于预期触发 -> 未错过', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setRuns([{ taskKey: 'taskA', startTime: expected, endTime: expected + 60000, success: true }]);
    expect(getMissedTaskRuns()).toEqual([]);
  });

  it('上次执行等于预期触发 -> 未错过（>= 边界）', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setRuns([{ taskKey: 'taskA', startTime: expected - 60000, endTime: expected, success: true }]);
    expect(getMissedTaskRuns()).toEqual([]);
  });

  // #endregion


  // #region 多记录聚合

  it('同一任务多条记录 -> 取最近的 endTime', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setRuns([
      { taskKey: 'taskA', startTime: 1000, endTime: expected - 120000, success: true },
      { taskKey: 'taskA', startTime: 2000, endTime: expected - 60000, success: true },
    ]);
    const result = getMissedTaskRuns();
    // 取较大 endTime（expected - 60000），仍早于 expected -> 错过
    expect(result).toHaveLength(1);
    expect(result[0].lastRunTime).toBe(expected - 60000);
  });

  it('同一任务多条记录且最近一次晚于预期 -> 未错过', () => {
    registerTask('taskA', '任务A');
    const expected = prevTime('0 * * * *');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    setRuns([
      { taskKey: 'taskA', startTime: 1000, endTime: expected - 60000, success: true },
      { taskKey: 'taskA', startTime: 2000, endTime: expected + 60000, success: true },
    ]);
    expect(getMissedTaskRuns()).toEqual([]);
  });

  // #endregion


  // #region 任务名称

  it('有 overrides.name -> 使用覆盖名', () => {
    registerTask('taskA', '默认名');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true, overrides: { name: '覆盖名' } } });
    expect(getMissedTaskRuns()[0].taskName).toBe('覆盖名');
  });

  it('无 overrides.name -> 使用 defaultName', () => {
    registerTask('taskA', '默认名');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true } });
    expect(getMissedTaskRuns()[0].taskName).toBe('默认名');
  });

  it('overrides.name 为空字符串 -> 回退 defaultName', () => {
    registerTask('taskA', '默认名');
    setConfigs({ taskA: { cron: '0 * * * *', enabled: true, overrides: { name: '' } } });
    expect(getMissedTaskRuns()[0].taskName).toBe('默认名');
  });

  // #endregion


  // #region 排序

  it('多任务错过 -> 按 lastExpectedTime 倒序', () => {
    registerTask('taskA', '任务A');
    registerTask('taskB', '任务B');
    setConfigs({
      // 0 * * * * 的 prev 为当前小时 0 分（10:00）
      taskA: { cron: '0 * * * *', enabled: true },
      // 15 * * * * 的 prev 为当前小时 15 分（10:15），晚于 10:00
      taskB: { cron: '15 * * * *', enabled: true },
    });
    setRuns([]);
    const result = getMissedTaskRuns();
    // 10:15 > 10:00，倒序后 taskB 在前
    expect(result.map((m) => m.taskKey)).toEqual(['taskB', 'taskA']);
  });

  // #endregion


  // #region 混合场景

  it('混合：部分错过、部分已执行、部分跳过', () => {
    registerTask('missed', '错过任务');
    registerTask('ran', '已执行任务');
    registerTask('disabled', '未启用任务');
    registerTask('running', '运行中任务');
    const expected = prevTime('0 * * * *');
    setConfigs({
      missed: { cron: '0 * * * *', enabled: true },
      ran: { cron: '0 * * * *', enabled: true },
      disabled: { cron: '0 * * * *', enabled: false },
      running: { cron: '0 * * * *', enabled: true },
    });
    setRuns([
      { taskKey: 'ran', startTime: expected, endTime: expected + 60000, success: true },
    ]);
    setRunning(['running']);
    expect(getMissedTaskRuns().map((m) => m.taskKey)).toEqual(['missed']);
  });

  // #endregion
});
