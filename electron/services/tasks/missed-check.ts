/**
 * 错过任务检查
 *
 * 应用启动时检查启用任务在关闭期间是否有错过的预期执行：
 * 对每个启用任务计算 now 之前最近一次 cron 预期触发时间，
 * 若该时间晚于上次执行结束时间（且任务当前未在运行、距 now 超过容差），
 * 则视为该次预期执行被错过，由渲染进程弹窗提示用户。
 *
 * 从未执行过的任务没有执行记录作基准，改以应用最后存活时间（lastAliveAt）判定：
 * 仅当预期触发晚于最后存活时间（触发时应用确定未运行）才报错过，
 * 否则触发时任务可能尚未配置，无法与真正的错过区分，保守跳过避免误报。
 *
 * 检查为异步触发、不阻塞启动：主进程在 IPC handler 中按需调用，
 * 渲染进程在任务配置与执行记录加载完成后主动查询。
 */
import { Cron } from 'croner';
import { getAllTaskRuns, getLastAliveAt, getTaskConfigStore } from '../store';
import { TASK_REGISTRY } from './registry';
import { getRunningTasks } from './runner';
import type { MissedTaskInfo } from '@shared/types';

/** 容差：预期触发时间距 now 不足此值时视为可能正在被调度器触发，不报错过（毫秒） */
const JUST_NOW_TOLERANCE = 60 * 1000;

/**
 * 检查启用任务在应用关闭期间是否有错过的执行
 *
 * @returns 错过的任务信息列表（按预期触发时间倒序，最近错过的排前面）
 */
export function getMissedTaskRuns(): MissedTaskInfo[] {
  const { configs } = getTaskConfigStore();
  const records = getAllTaskRuns();
  const running = new Set(getRunningTasks());
  /** 应用最后存活时间：从未执行的任务以此为基准判定触发时应用是否在运行 */
  const lastAliveAt = getLastAliveAt();
  const now = Date.now();

  // 按任务聚合最近一次执行结束时间
  const lastRunByTask = new Map<string, number>();
  for (const r of records) {
    const prev = lastRunByTask.get(r.taskKey);
    if (prev === undefined || r.endTime > prev) {
      lastRunByTask.set(r.taskKey, r.endTime);
    }
  }

  const missed: MissedTaskInfo[] = [];
  for (const [key, config] of Object.entries(configs)) {
    if (!config.enabled || !config.cron) {
      continue;
    }
    // 注册表已移除的任务跳过
    if (!TASK_REGISTRY[key]) {
      continue;
    }
    // 正在运行的任务不算错过（可能刚被触发）
    if (running.has(key)) {
      continue;
    }

    // 计算 now 之前最近一次 cron 预期触发时间
    let lastExpectedTime: number;
    try {
      const [prev] = new Cron(config.cron, { paused: true }).previousRuns(1, new Date(now));
      if (!prev) {
        continue;
      }
      lastExpectedTime = prev.getTime();
    } catch {
      continue;
    }
    // 距 now 过近，可能正被调度器触发，跳过避免误报
    if (now - lastExpectedTime < JUST_NOW_TOLERANCE) {
      continue;
    }

    const lastRunTime = lastRunByTask.get(key) ?? null;
    if (lastRunTime === null) {
      // 从未执行的任务无执行记录作基准：仅当预期触发晚于应用最后存活时间，
      // 即触发时刻应用确定未运行时才视为关闭期间错过；
      // 否则触发时刻任务可能尚未配置，无法与真正的错过区分，保守跳过
      if (lastExpectedTime <= lastAliveAt) {
        continue;
      }
    } else if (lastRunTime >= lastExpectedTime) {
      // 上次执行晚于最近预期触发，说明已正常执行，未错过
      continue;
    }

    missed.push({
      taskKey: key,
      taskName: config.overrides?.name || TASK_REGISTRY[key].defaultName,
      lastExpectedTime,
      lastRunTime,
    });
  }

  // 按预期触发时间倒序（最近错过的排前面）
  missed.sort((a, b) => b.lastExpectedTime - a.lastExpectedTime);
  return missed;
}
