import type { TaskLogEvent } from '@shared/types';

/**
 * 合并日志历史与加载期间缓存的实时事件
 *
 * 主进程读取历史文件和推送实时日志之间存在时间重叠，同一条新日志可能同时出现在两组数据中。
 * 新事件带有 eventId 时按标识去重；旧日志没有标识时保持原样，兼容已有日志文件。
 */
export function mergeInitialLogs(
  history: TaskLogEvent[],
  buffered: TaskLogEvent[],
): TaskLogEvent[] {
  const result = [...history];
  const seenIds = new Set(history.flatMap((event) => event.eventId ? [event.eventId] : []));
  for (const event of buffered) {
    if (event.eventId && seenIds.has(event.eventId)) {
      continue;
    }
    if (event.eventId) {
      seenIds.add(event.eventId);
    }
    result.push(event);
  }
  return result;
}
