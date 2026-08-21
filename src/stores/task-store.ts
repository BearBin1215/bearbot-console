/**
 * 任务状态管理
 *
 * 设计：
 * - taskDefinitions：从主进程 IPC 获取的任务元数据（不可变）
 * - taskConfigs：用户配置（持久化到 electron-store，包含 cron、enabled、overrides）
 * - tasks：合并后的完整任务列表（用于 UI 展示）
 *
 * 持久化机制：
 * - 启动时从 electron-store 加载 taskConfigs
 * - 每次 taskConfigs 变更时自动写入 electron-store
 */
import { create } from 'zustand';
import type { TaskDefinition, TaskConfig, TaskParamValues } from '@shared/types';
import type { TaskInfo } from '@/lib/types';
import { isCronValid } from '@/lib/cron';

/** 合并定义和配置，生成 UI 展示用的 TaskInfo */
export function buildTaskList(
  definitions: TaskDefinition[],
  configs: Record<string, TaskConfig>,
  order?: string[],
): TaskInfo[] {
  // 按 order 排序，没有 order 则按定义顺序
  const orderedKeys = order ?? definitions.map((d) => d.taskKey);
  const defMap = new Map(definitions.map((d) => [d.taskKey, d]));

  const result: TaskInfo[] = [];
  for (const key of orderedKeys) {
    const def = defMap.get(key);
    if (!def) {
      continue;
    }
    const config = configs[key] ?? { cron: '', enabled: false };
    result.push({
      taskKey: def.taskKey,
      name: config.overrides?.name || def.defaultName,
      description: config.overrides?.description || def.defaultDescription,
      cron: config.cron,
      enabled: config.enabled,
      accountId: config.accountId,
      defaultName: def.defaultName,
      defaultDescription: def.defaultDescription,
      params: def.params,
      paramValues: config.params,
    });
  }
  return result;
}

interface TaskStore {
  /** 任务定义（从主进程 IPC 获取） */
  taskDefinitions: TaskDefinition[];
  /** 任务配置（可持久化部分） */
  taskConfigs: Record<string, TaskConfig>;
  /** 任务排序顺序（key 数组） */
  taskOrder: string[];
  /** 合并后的任务列表（用于 UI 展示） */
  tasks: TaskInfo[];
  /** 正在执行的任务 key 集合（由主进程 task:status 推送驱动） */
  runningKeys: Set<string>;
  /** 是否已从持久化存储加载 */
  loaded: boolean;
  /** 从主进程和持久化存储加载任务定义与配置 */
  loadConfigs: () => Promise<void>;
  /** 切换任务启用状态 */
  toggleTask: (taskKey: string, enabled: boolean) => void;
  /** 更新任务的 cron 表达式 */
  updateTaskCron: (taskKey: string, cron: string) => void;
  /** 更新任务的显示设置（名称、描述覆盖） */
  updateTaskOverrides: (taskKey: string, overrides: { name?: string; description?: string }) => void;
  /** 更新任务绑定的执行账号 */
  updateTaskAccount: (taskKey: string, accountId: string | undefined) => void;
  /** 更新任务参数值（与注册表 params 字段对应） */
  updateTaskParams: (taskKey: string, params: TaskParamValues) => void;
  /** 重新排序任务 */
  reorderTasks: (newOrder: string[]) => void;
  /** 设置任务运行状态（由主进程 task:status 事件调用） */
  setTaskRunning: (taskKey: string, running: boolean) => void;
}

/** 持久化 taskConfigs 到 electron-store */
async function persistConfigs(configs: Record<string, TaskConfig>, order: string[]): Promise<void> {
  // order 与 configs 结构化分离存储，避免在配置表中混入保留键
  await window.ipcRenderer.invoke('task-config:set', { order, configs });
}

/** 空配置：任务从未配置过时作为补丁基准 */
const EMPTY_CONFIG: TaskConfig = { cron: '', enabled: false };

/** 任务状态 store */
export const useTaskStore = create<TaskStore>((set, get) => {
  /**
   * 更新单个任务的配置并持久化
   *
   * 各更新动作的公共流程：以现有配置（不存在时为 {@link EMPTY_CONFIG}）为基准生成补丁，
   * 写回 taskConfigs 与重建后的 tasks，再持久化到 electron-store（排序不变）。
   *
   * @param taskKey 任务 key
   * @param buildPatch 由现有配置生成新配置，返回 undefined 表示放弃本次更新（不写入也不持久化）
   */
  const patchConfig = async (
    taskKey: string,
    buildPatch: (existing: TaskConfig) => TaskConfig | undefined,
  ): Promise<void> => {
    const state = get();
    const patched = buildPatch(state.taskConfigs[taskKey] ?? EMPTY_CONFIG);
    if (!patched) {
      return;
    }
    const newConfigs = { ...state.taskConfigs, [taskKey]: patched };
    set({
      taskConfigs: newConfigs,
      tasks: buildTaskList(state.taskDefinitions, newConfigs, state.taskOrder),
    });
    await persistConfigs(newConfigs, state.taskOrder);
  };

  return {
    taskDefinitions: [],
    taskConfigs: {},
    taskOrder: [],
    tasks: [],
    runningKeys: new Set<string>(),
    loaded: false,

    loadConfigs: async () => {
      // 从主进程获取任务定义
      const definitions = await window.ipcRenderer.invoke('task:definitions');
      // 从 electron-store 加载用户配置（order 与 configs 分离存储，无需结构性断言）
      const stored = await window.ipcRenderer.invoke('task-config:get');
      const { order, configs } = stored;
      // 使用存储的排序，缺失的 key 追加到末尾
      const defaultOrder = definitions.map((d) => d.taskKey);
      const finalOrder = order.length
        ? [...order, ...defaultOrder.filter((k) => !order.includes(k))]
        : defaultOrder;
      set({
        taskDefinitions: definitions,
        taskConfigs: configs,
        taskOrder: finalOrder,
        tasks: buildTaskList(definitions, configs, finalOrder),
        loaded: true,
      });
    },

    toggleTask: (taskKey, enabled) => {
      void patchConfig(taskKey, (existing) => {
        // 启用时验证 cron 是否有效，无效则放弃本次切换
        if (enabled && !isCronValid(existing.cron)) {
          return undefined;
        }
        return { ...existing, enabled };
      });
    },

    updateTaskCron: (taskKey, cron) => {
      void patchConfig(taskKey, (existing) => ({
        ...existing,
        cron,
        // 新 cron 无效时自动禁用，避免 enabled 与 cron 不一致
        enabled: isCronValid(cron) ? existing.enabled : false,
      }));
    },

    updateTaskOverrides: (taskKey, overrides) => {
      void patchConfig(taskKey, (existing) => ({
        ...existing,
        overrides: { ...existing.overrides, ...overrides },
      }));
    },

    updateTaskAccount: (taskKey, accountId) => {
      void patchConfig(taskKey, (existing) => ({ ...existing, accountId }));
    },

    updateTaskParams: (taskKey, params) => {
      void patchConfig(taskKey, (existing) => ({ ...existing, params }));
    },

    reorderTasks: async (newOrder) => {
      const state = get();
      set({
        taskOrder: newOrder,
        tasks: buildTaskList(state.taskDefinitions, state.taskConfigs, newOrder),
      });
      await persistConfigs(state.taskConfigs, newOrder);
    },

    setTaskRunning: (taskKey, running) => {
      const next = new Set(get().runningKeys);
      if (running) {
        next.add(taskKey);
      } else {
        next.delete(taskKey);
      }
      set({ runningKeys: next });
    },
  };
});
