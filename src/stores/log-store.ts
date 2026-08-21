import { create } from 'zustand';
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

/** 最多保留的日志条目数（会话内累计上限；启动加载量见主进程 log:load，二者不必相等） */
const MAX_LOGS = 200;

interface LogStore {
  /** 日志列表 */
  logs: LogEntry[];
  /** 是否已从持久化存储加载 */
  loaded: boolean;
  /** 追加一条实时日志，超过上限时丢弃最早的条目 */
  addLog: (event: TaskLogEvent) => void;
  /** 批量加载持久化日志（启动时调用），替换当前列表 */
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
    set((state) => ({ logs: [...state.logs.slice(-(MAX_LOGS - 1)), entry] }));
  },
  loadLogs: (events) => {
    set({ logs: events.map((e) => ({ id: nextId++, ...e })), loaded: true });
  },
  clearLogs: () => set({ logs: [] }),
}));
