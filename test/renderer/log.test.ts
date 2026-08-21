import { describe, expect, it } from 'vitest';
import type { TaskLogEvent } from '@shared/types';
import { mergeInitialLogs } from '@/lib/log';

/** 创建最小日志事件测试数据 */
function createLog(eventId: string | undefined, message: string): TaskLogEvent {
  return {
    eventId,
    time: '2026-08-18 12:00:00',
    level: 'INFO',
    taskKey: 'test',
    message,
  };
}

describe('mergeInitialLogs', () => {
  it('合并历史日志与加载期间的新实时日志', () => {
    const history = [createLog('history-1', '历史')];
    const buffered = [createLog('realtime-1', '实时')];

    expect(mergeInitialLogs(history, buffered).map((event) => event.message)).toEqual(['历史', '实时']);
  });

  it('按 eventId 去除同时存在于历史和实时缓存中的同一事件', () => {
    const history = [createLog('same-id', '同一条日志')];
    const buffered = [createLog('same-id', '同一条日志')];

    expect(mergeInitialLogs(history, buffered)).toHaveLength(1);
  });

  it('保留没有 eventId 的旧格式日志', () => {
    const history = [createLog(undefined, '旧历史')];
    const buffered = [createLog(undefined, '旧实时')];

    expect(mergeInitialLogs(history, buffered)).toHaveLength(2);
  });
});
