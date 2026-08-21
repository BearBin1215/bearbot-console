/**
 * 任务执行记录状态管理
 *
 * 设计：
 * - records：从主进程持久化存储加载的任务执行记录（已按 90 天窗口裁剪）
 * - 启动时通过 IPC 加载；任务执行结束时由主进程 task:run-record 事件增量推送
 *
 * 保留窗口：保留最近 90 天的记录，与主进程持久化的保留期一致；
 * 渲染进程在追加时再次裁剪，保证内存中不累积过期记录。
 */
import { create } from 'zustand';
import type { TaskRunRecord } from '@shared/types';

/** 任务执行记录保留天数（与主进程持久化保留期一致） */
const RETENTION_DAYS = 90;

interface TaskRunStore {
  /** 任务执行记录列表（按时间顺序追加，已裁剪过期记录） */
  records: TaskRunRecord[];
  /** 是否已从持久化存储加载 */
  loaded: boolean;
  /** 从主进程加载任务执行记录 */
  loadRecords: () => Promise<void>;
  /** 追加一条执行记录并裁剪超出保留期的旧记录 */
  addRecord: (record: TaskRunRecord) => void;
}

/** 计算保留期截止时间戳（毫秒） */
function getRetentionCutoff(): number {
  return Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/** 任务执行记录 store */
export const useTaskRunStore = create<TaskRunStore>((set) => ({
  records: [],
  loaded: false,

  loadRecords: async () => {
    const records = await window.ipcRenderer.invoke('task-runs:get');
    set({ records, loaded: true });
  },

  addRecord: (record) => {
    const cutoff = getRetentionCutoff();
    set((state) => ({
      records: [...state.records.filter((r) => r.endTime >= cutoff), record],
    }));
  },
}));
