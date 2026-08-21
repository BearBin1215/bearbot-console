import { useEffect } from 'react';
import type { TaskLogEvent } from '@shared/types';
import { useAccountStore } from '@/stores/account-store';
import { useTaskStore } from '@/stores/task-store';
import { useTaskRunStore } from '@/stores/task-run-store';
import { useLogStore } from '@/stores/log-store';
import { mergeInitialLogs } from '@/lib/log';

/**
 * 应用级 IPC 订阅与初始数据加载
 *
 * 在根组件调用一次，负责：
 * - 启动时加载账号、任务配置、执行记录
 * - 加载持久化日志历史并订阅实时任务日志
 * - 订阅主进程推送的任务运行状态与执行记录
 */
export function useIpcListeners(): void {
  const loadAccounts = useAccountStore((s) => s.loadAccounts);
  const loadConfigs = useTaskStore((s) => s.loadConfigs);
  const loadRecords = useTaskRunStore((s) => s.loadRecords);

  // 启动时加载账号、任务配置与执行记录
  useEffect(() => {
    void loadAccounts();
    void loadConfigs();
    void loadRecords();
  }, [loadAccounts, loadConfigs, loadRecords]);

  // 先订阅实时日志并暂存，再加载历史；避免历史读取期间的实时事件丢失。
  useEffect(() => {
    let cancelled = false;
    let historyLoaded = false;
    const buffered: TaskLogEvent[] = [];
    const off = window.ipcRenderer.on('task:log', (payload) => {
      if (!historyLoaded) {
        buffered.push(payload);
        return;
      }
      useLogStore.getState().addLog(payload);
    });
    void window.ipcRenderer.invoke('log:load').then((logs) => {
      if (cancelled) {
        return;
      }
      useLogStore.getState().loadLogs(mergeInitialLogs(logs, buffered));
      historyLoaded = true;
    }).catch(() => {
      if (cancelled) {
        return;
      }
      // 历史文件读取失败时仍展示加载期间收到的实时日志。
      useLogStore.getState().loadLogs(buffered);
      historyLoaded = true;
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // 订阅主进程任务状态，更新 taskStore.runningKeys 用于禁用执行按钮
  useEffect(() => {
    return window.ipcRenderer.on('task:status', (payload) => {
      useTaskStore.getState().setTaskRunning(payload.taskKey, payload.running);
    });
  }, []);

  // 启动时同步主进程运行中的任务：窗口销毁重建后 task:status 推送会丢失，需主动查询一次
  useEffect(() => {
    void window.ipcRenderer.invoke('task:running').then((keys) => {
      useTaskStore.setState({ runningKeys: new Set(keys) });
    });
  }, []);

  // 订阅主进程任务执行记录，更新 taskRunStore 用于顶部统计与「最近执行」
  useEffect(() => {
    return window.ipcRenderer.on('task:run-record', (payload) => {
      useTaskRunStore.getState().addRecord(payload);
    });
  }, []);
}
