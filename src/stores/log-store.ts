import { create } from 'zustand';
import { MAX_LOG_ENTRIES } from '@shared/log';
import type { LogLevel, TaskLogEvent } from '@shared/types';

/** 日志条目（内存中展示用，含自增 id） */
export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  /** 来源任务编码（渲染时根据此 key 动态查找任务名，避免改名后历史日志不一致） */
  taskKey: string;
  message: string;
  /** 是否为执行器发出的系统消息（如任务开始/结束），渲染时显示【SYS】替代任务名 */
  system?: boolean;
  /** 请求/响应等详细诊断信息（界面中可折叠查看；可选） */
  detail?: string;
}

interface LogStore {
  /** 日志列表 */
  logs: LogEntry[];
  /** 是否已从持久化存储加载 */
  loaded: boolean;
  /** 追加一条实时日志，超过上限时丢弃最早的条目 */
  addLog: (event: TaskLogEvent) => void;
  /** 批量加载持久化日志（启动时调用），替换当前列表并裁剪至上限 */
  loadLogs: (events: TaskLogEvent[]) => void;
  /** 清空所有日志（仅清内存，不影响持久化文件） */
  clearLogs: () => void;
}

let nextId = 1;

export const useLogStore = create<LogStore>((set) => ({
  logs: [],
  loaded: false,
  addLog: (event) => {
    const entry: LogEntry = { id: nextId++, ...event };
    set((state) => ({ logs: [...state.logs.slice(-(MAX_LOG_ENTRIES - 1)), entry] }));
  },
  loadLogs: (events) => {
    // 历史与加载期间收到的实时日志合并后可能超过上限，统一裁剪到最近条目
    const entries = events.map((e) => ({ id: nextId++, ...e }));
    set({ logs: entries.slice(-MAX_LOG_ENTRIES), loaded: true });
  },
  clearLogs: () => set({ logs: [] }),
}));
