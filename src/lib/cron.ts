import { humanizeCronInChinese } from 'cron-chinese';
import { Cron } from 'croner';

/**
 * 安全地将 cron 表达式转为中文可读文本
 * @param fallback - 解析失败时的回退文本，默认 '未设置'
 */
export function formatCron(cron: string, fallback = '未设置'): string {
  try {
    return humanizeCronInChinese(cron);
  } catch {
    return fallback;
  }
}

/**
 * 计算 cron 表达式的下一次执行时间（本地时区）
 * @returns 下一次执行时间，解析失败返回 null
 */
export function getNextCronTime(cron: string): Date | null {
  try {
    return new Cron(cron, { paused: true }).nextRun();
  } catch {
    return null;
  }
}

/** 验证 cron 表达式是否有效 */
export function isCronValid(cron: string): boolean {
  if (!cron.trim()) {
    return false;
  }
  return getNextCronTime(cron) !== null;
}

/** 高频调度阈值（毫秒）：10 分钟 */
const HIGH_FREQUENCY_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * 高频检查取样点数
 *
 * 分钟字段单值时任意相邻触发间隔不小于 60 分钟（必不高频）；分钟字段多值时，
 * 最小相邻间隔只会出现在同小时内相邻分钟对或跨小时首尾对中，61 个连续触发点
 * （覆盖完整小时周期）必包含这两类相邻对。
 */
const HIGH_FREQUENCY_SAMPLE_RUNS = 61;

/**
 * 判断 cron 是否为高频调度（存在相邻两次触发的间隔小于阈值）
 *
 * 解析表达式取接下来 61 次触发时间，按真实相邻间隔判定，
 * 可正确覆盖分钟列表混合范围元素（如 5-8,30）、跨小时首尾（如 5,56）等字段组合分析的盲区。
 * 无效输入（空字符串、无法解析等）返回 false。
 *
 * @param cron cron 表达式
 */
export function isHighFrequencyCron(cron: string): boolean {
  try {
    const runs = new Cron(cron, { paused: true }).nextRuns(HIGH_FREQUENCY_SAMPLE_RUNS);
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].getTime() - runs[i - 1].getTime() < HIGH_FREQUENCY_THRESHOLD_MS) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
