import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TaskRunRecord } from '@shared/types';
import { aggregateTaskRunStats, getStatsRangeCutoff } from '../../src/lib/task';

/**
 * 固定测试时间（本地 2026-01-15 10:30:30）
 *
 * 用本地时间构造以保证小时/分钟值与时区无关，覆盖今日/滚动窗口边界。
 */
const NOW_DATE = new Date(2026, 0, 15, 10, 30, 30);
const NOW = NOW_DATE.getTime();
const DAY = 24 * 60 * 60 * 1000;

type RunStatus = 'success' | 'failed' | 'aborted';

/** 构造一条执行记录，endOffsetMs 为结束时间距 NOW 的毫秒数（正数表示过去） */
function run(taskKey: string, endOffsetMs: number, status: RunStatus): TaskRunRecord {
  const endTime = NOW - endOffsetMs;
  return {
    taskKey,
    startTime: endTime - 60_000,
    endTime,
    success: status === 'success',
    aborted: status === 'aborted',
  };
}

/** 构造 taskKey -> name 映射 */
function nameMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

// 测试 aggregateTaskRunStats 与 getStatsRangeCutoff（按时间段过滤并按任务聚合执行统计）
describe('aggregateTaskRunStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // #region 时间段过滤

  it('week 只统计 7 天内的记录', () => {
    const records = [
      run('a', 5 * DAY, 'success'), // 5 天前，包含
      run('a', 10 * DAY, 'success'), // 10 天前，排除
    ];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(1);
  });

  it('today 只统计当日 00:00 起的记录', () => {
    const records = [
      run('a', 2 * 60 * 60 * 1000, 'success'), // 2 小时前（今日），包含
      run('a', 25 * 60 * 60 * 1000, 'success'), // 25 小时前（昨日），排除
    ];
    const items = aggregateTaskRunStats(records, 'today', nameMap({ a: '任务A' }));
    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(1);
  });

  it('month 统计 30 天内的记录，更早的排除', () => {
    const records = [
      run('a', 20 * DAY, 'success'), // 20 天前，包含
      run('a', 40 * DAY, 'success'), // 40 天前，排除
    ];
    const items = aggregateTaskRunStats(records, 'month', nameMap({ a: '任务A' }));
    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(1);
  });

  it('记录 endTime 恰好等于 cutoff 仍被包含（>= 边界）', () => {
    // week cutoff = NOW - 7d，恰好等于 cutoff 的记录应包含
    const records = [run('a', 7 * DAY, 'success')];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(1);
  });

  // #endregion

  // #region 归类规则

  it('aborted 优先于 success 归类为中止', () => {
    // 异常数据：同时标记 aborted 与 success，应计中止
    const records = [{
      ...run('a', 1000, 'success'),
      aborted: true,
    }];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items[0].aborted).toBe(1);
    expect(items[0].success).toBe(0);
  });

  it('三类状态分别计数', () => {
    const records = [
      run('a', 1000, 'success'),
      run('a', 2000, 'success'),
      run('a', 3000, 'failed'),
      run('a', 4000, 'aborted'),
    ];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items[0]).toMatchObject({ success: 2, failed: 1, aborted: 1, total: 4 });
  });

  // #endregion

  // #region 成功率与排序

  it('成功率 = success / total', () => {
    const records = [
      run('a', 1000, 'success'),
      run('a', 2000, 'success'),
      run('a', 3000, 'success'),
      run('a', 4000, 'failed'),
    ];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items[0].successRate).toBe(0.75);
  });

  it('无成功记录时成功率为 0', () => {
    const records = [
      run('a', 1000, 'failed'),
      run('a', 2000, 'aborted'),
    ];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items[0].successRate).toBe(0);
  });

  // #endregion

  // #region 名称映射与空数据

  it('已删除的任务（不在 taskNameMap 中）被过滤', () => {
    const records = [
      run('a', 1000, 'success'),
      run('deleted', 2000, 'success'),
    ];
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: '任务A' }));
    expect(items.map((i) => i.taskKey)).toEqual(['a']);
  });

  it('空记录数组返回空数组', () => {
    const items = aggregateTaskRunStats([], 'week', nameMap({}));
    expect(items).toEqual([]);
  });

  it('时间段内无记录的 taskKey 不出现在结果中', () => {
    const records = [run('a', 1000, 'success')]; // 仅 a 有记录
    const items = aggregateTaskRunStats(records, 'week', nameMap({ a: 'A', b: 'B' }));
    expect(items.map((i) => i.taskKey)).toEqual(['a']);
  });

  // #endregion
});

// 测试 getStatsRangeCutoff（时间段截止时间戳计算）
describe('getStatsRangeCutoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('today 为当日 00:00:00', () => {
    const expected = new Date(2026, 0, 15, 0, 0, 0).getTime();
    expect(getStatsRangeCutoff('today')).toBe(expected);
  });

  it('week 为 7 天前', () => {
    expect(getStatsRangeCutoff('week')).toBe(NOW - 7 * DAY);
  });

  it('month 为 30 天前', () => {
    expect(getStatsRangeCutoff('month')).toBe(NOW - 30 * DAY);
  });
});
