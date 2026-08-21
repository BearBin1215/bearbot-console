import dayjs from 'dayjs';
import type { TaskRunRecord, TaskParamField, TaskParamValues } from '@shared/types';

/** 任务执行统计的时间段选项 */
export type StatsRange = 'today' | 'week' | 'month';

/** 单个任务在某时间段内的执行统计项 */
export interface TaskStatItem {
  /** 任务标识 */
  taskKey: string;
  /** 任务显示名称 */
  name: string;
  /** 成功次数 */
  success: number;
  /** 失败次数 */
  failed: number;
  /** 手动停止次数 */
  aborted: number;
  /** 总执行次数 */
  total: number;
  /** 成功率（0-1） */
  successRate: number;
}

/** 任务执行状态标签信息 */
interface TaskRunStatus {
  /** Ant Design Tag 颜色 */
  color: string;
  /** 状态文本 */
  label: string;
}

/** 根据执行记录返回状态标签的颜色与文本（已停止 / 成功 / 失败） */
export function getRunStatus(record: TaskRunRecord): TaskRunStatus {
  if (record.aborted) {
    return { color: 'default', label: '已停止' };
  }
  if (record.success) {
    return { color: 'green', label: '成功' };
  }
  return { color: 'red', label: '失败' };
}

/**
 * 检查必填参数是否缺失
 *
 * 仅判断 required 字段是否有值（用户输入或默认值），不校验值的有效性。
 * @param fields 参数字段定义
 * @param values 用户已保存的参数值
 * @returns 缺失的必填字段标签列表
 */
export function getMissingRequiredParams(
  fields: TaskParamField[] | undefined,
  values: TaskParamValues | undefined,
): string[] {
  if (!fields || fields.length === 0) {
    return [];
  }
  const missing: string[] = [];
  for (const field of fields) {
    if (!field.required) {
      continue;
    }
    const v = values?.[field.key];
    const isMulti = field.type === 'multi-string' || field.type === 'multi-select';
    const hasValue = isMulti
      ? Array.isArray(v) && v.length > 0
      : v !== undefined && v !== '' && v !== null;
    if (!hasValue && field.default === undefined) {
      missing.push(field.label);
    }
  }
  return missing;
}

/** 滚动时间段的毫秒数：本周 7 天、本月 30 天 */
const ROLLING_MS: Record<Exclude<StatsRange, 'today'>, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/**
 * 计算统计时间段截止时间戳（毫秒），仅统计 endTime 不早于该时间戳的记录。
 *
 * - `today`：当日 00:00:00 起（自然日）
 * - `week`/`month`：以当前时刻向前滚动的固定天数窗口，与顶部「本周统计」口径一致
 */
export function getStatsRangeCutoff(range: StatsRange): number {
  if (range === 'today') {
    return dayjs().startOf('day').valueOf();
  }
  return Date.now() - ROLLING_MS[range];
}

/**
 * 按时间段过滤执行记录并按 taskKey 聚合统计。
 *
 * 归类规则与 {@link getRunStatus} 一致：`aborted` 优先计中止，否则 `success` 计成功，其余计失败。
 * 已从任务列表中删除的任务（不在 taskNameMap 中）不计入统计。
 * 返回结果不保证顺序，由展示层自行排序。
 *
 * @param records 任务执行记录（已按时间顺序追加）
 * @param range 统计时间段
 * @param taskNameMap taskKey -> 任务显示名称映射（仅含当前存在的任务）
 */
export function aggregateTaskRunStats(
  records: TaskRunRecord[],
  range: StatsRange,
  taskNameMap: Map<string, string>,
): TaskStatItem[] {
  const cutoff = getStatsRangeCutoff(range);
  /** taskKey -> 累计分项计数 */
  const buckets = new Map<string, { success: number; failed: number; aborted: number }>();

  for (const r of records) {
    // 跳过已删除任务与超出时间段的记录
    if (!taskNameMap.has(r.taskKey) || r.endTime < cutoff) {
      continue;
    }
    let bucket = buckets.get(r.taskKey);
    if (!bucket) {
      bucket = { success: 0, failed: 0, aborted: 0 };
      buckets.set(r.taskKey, bucket);
    }
    if (r.aborted) {
      bucket.aborted++;
    } else if (r.success) {
      bucket.success++;
    } else {
      bucket.failed++;
    }
  }

  const items: TaskStatItem[] = [];
  for (const [taskKey, counts] of buckets) {
    const total = counts.success + counts.failed + counts.aborted;
    items.push({
      taskKey,
      name: taskNameMap.get(taskKey)!,
      success: counts.success,
      failed: counts.failed,
      aborted: counts.aborted,
      total,
      successRate: counts.success / total,
    });
  }

  return items;
}
