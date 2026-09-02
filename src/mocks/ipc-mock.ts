/**
 * 网页演示模式的 IPC 模拟实现
 *
 * 实现 shared/ipc.ts 定义的 IpcRendererApi 窄接口，使渲染进程在无 Electron
 * preload 的浏览器环境中正常运行：
 * - 所有 invoke 附带 100~300ms 随机延时，模拟真实 IPC 往返
 * - 所有数据仅保留在内存，刷新后重置为演示默认数据（背景图顺序随机），
 *   不读写 localStorage，不产生任何本地持久化
 * - 任务执行通过定时器生成模拟日志流，按真实事件链路推送 task:log /
 *   task:status / task:run-record，支持多任务并行与手动停止
 * - 不会产生任何真实网络请求
 */
import dayjs from 'dayjs';
import type {
  IpcEventChannel,
  IpcEventMap,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcRendererApi,
} from '@shared/ipc';
import type { Account, SettingsData, TaskConfigStoreData, TaskLogEvent, TaskRunRecord } from '@shared/types';
import {
  MOCK_ACCOUNTS,
  MOCK_TASK_CONFIGS,
  MOCK_TASK_DEFINITIONS,
  MOCK_TASK_RUN_SCRIPTS,
  createMockLogs,
  createMockRunRecords,
  createMockSettings,
  fillMessage,
  randomInt,
} from './mock-data';

/** 内存日志上限（超出后丢弃最旧的记录） */
const MAX_LOGS = 500;
/** 内存执行记录上限（超出后丢弃最旧的记录） */
const MAX_RUN_RECORDS = 500;

/** 事件监听器集合（channel -> listener 集合） */
const listeners: Record<IpcEventChannel, Set<(...args: unknown[]) => void>> = {
  'task:log': new Set(),
  'task:status': new Set(),
  'task:run-record': new Set(),
};

/** 日志事件序号（用于生成 eventId） */
let logSeq = 0;

/** 内存态：设置（每次进入以默认设置重置，背景图顺序随机） */
let settings: SettingsData = createMockSettings();

/** 内存态：账号列表（固定为演示账号，刷新后恢复默认） */
let accounts: Account[] = [...MOCK_ACCOUNTS];

/** 内存态：任务调度配置（取自实际部署的默认配置，刷新后重置） */
let taskConfig: TaskConfigStoreData = MOCK_TASK_CONFIGS;

/** 内存态：日志（初始含一份最近定时执行的演示历史，刷新后重建） */
let logs: TaskLogEvent[] = createMockLogs();

/** 内存态：任务执行记录（刷新后重建演示历史） */
let runRecords: TaskRunRecord[] = createMockRunRecords();

/** 运行中的模拟任务（taskKey -> 运行状态） */
const runningTasks = new Map<string, { stopped: boolean; startTime: number }>();

/** 延时指定的毫秒数 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 格式化当前时间为日志时间格式 */
function formatNow(): string {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

/** 向订阅者推送事件 */
function emit<C extends IpcEventChannel>(channel: C, ...args: IpcEventMap[C]): void {
  for (const listener of listeners[channel]) {
    listener(...args);
  }
}

/**
 * 追加一条日志：写入内存，并按真实链路推送 task:log 事件
 *
 * @param taskKey 任务标识（系统消息使用 __system__）
 * @param level 日志级别
 * @param message 日志文本
 * @param system 是否为系统消息
 * @param detail 详细诊断信息（可选）
 */
function appendLog(taskKey: string, level: TaskLogEvent['level'], message: string, system?: boolean, detail?: string): void {
  const event: TaskLogEvent = {
    taskKey,
    level,
    message,
    time: formatNow(),
    eventId: `${Date.now()}-${logSeq++}`,
    ...(system ? { system } : {}),
    ...(detail ? { detail } : {}),
  };
  logs = [...logs, event].slice(-MAX_LOGS);
  emit('task:log', event);
}

/** 追加任务执行记录：写入内存并推送 task:run-record 事件 */
function appendRunRecord(record: TaskRunRecord): void {
  runRecords = [...runRecords, record].slice(-MAX_RUN_RECORDS);
  emit('task:run-record', record);
}

/** 从演示任务定义中获取任务默认名称 */
function getTaskName(taskKey: string): string {
  return MOCK_TASK_DEFINITIONS.find((definition) => definition.taskKey === taskKey)?.defaultName ?? taskKey;
}

/**
 * 模拟单个任务的执行过程
 *
 * 按预置运行脚本顺序播放日志步骤（文案与真实任务脚本一致），SYS 开始/完成消息
 * 文案与主进程 runner 一致；结束后推送状态与执行记录。可被 task:stop 中断。
 *
 * @param taskKey 任务标识
 */
function startMockRun(taskKey: string): void {
  const taskName = getTaskName(taskKey);
  const state = { stopped: false, startTime: Date.now() };
  runningTasks.set(taskKey, state);

  emit('task:status', { taskKey, running: true });
  appendLog(taskKey, 'INFO', `开始执行任务【${taskName}】`, true);

  const steps = MOCK_TASK_RUN_SCRIPTS[taskKey] ?? [];

  /** 递归播放日志步骤，播完推送 SYS 完成消息、状态与执行记录 */
  const play = (index: number) => {
    if (state.stopped) {
      return;
    }
    if (index >= steps.length) {
      appendLog(taskKey, 'INFO', `【${taskName}】执行完成`, true);
      emit('task:status', { taskKey, running: false });
      appendRunRecord({
        taskKey,
        startTime: state.startTime,
        endTime: Date.now(),
        success: true,
      });
      runningTasks.delete(taskKey);
      return;
    }
    const step = steps[index];
    const delayMs = (step.gap ?? 1) * 1000 * (0.8 + Math.random() * 0.4);
    setTimeout(() => {
      if (state.stopped) {
        return;
      }
      appendLog(taskKey, 'INFO', fillMessage(step.message, step.values));
      play(index + 1);
    }, delayMs);
  };
  play(0);
}

/** 停止指定任务的模拟执行，SYS 消息与执行记录对齐主进程 runner 的手动停止行为 */
function stopMockRun(taskKey: string): void {
  const state = runningTasks.get(taskKey);
  if (!state) {
    return;
  }
  state.stopped = true;
  runningTasks.delete(taskKey);

  appendLog(taskKey, 'WARN', `【${getTaskName(taskKey)}】已手动停止`, true);
  emit('task:status', { taskKey, running: false });
  appendRunRecord({
    taskKey,
    startTime: state.startTime,
    endTime: Date.now(),
    success: false,
    aborted: true,
  });
}

/** 创建演示账号（以输入的用户名登录成功） */
function createAccount(username: string): Account {
  return {
    id: `mock-account-${crypto.randomUUID()}`,
    username,
    userId: null,
    groups: ['*', 'user'],
    rights: ['read', 'edit', 'writeapi'],
    displayname: username,
    displaytag: null,
    loggedIn: true,
  };
}

/** 各 invoke 通道的模拟处理器（键与返回值严格对应 IpcInvokeMap 契约） */
const invokeHandlers = {
  'settings:get': () => settings,
  // 设置仅当前会话生效，刷新后重置为演示默认值
  'settings:patch': (data: Partial<SettingsData>) => {
    settings = { ...settings, ...data };
  },
  'settings:open-dir': () => '（网页演示模式：本地存储目录不可用）',
  'settings:select-image': () => null,
  'settings:preview-image': (filePath: string) => {
    if (/^(data:|https?:|\/)/.test(filePath)) {
      window.open(filePath, '_blank', 'noopener,noreferrer');
    }
  },

  'task-config:get': () => taskConfig,
  // 任务调度配置仅当前会话生效，刷新后重置为演示默认配置
  'task-config:set': (data: TaskConfigStoreData) => {
    taskConfig = data;
  },
  'task-runs:get': () => runRecords,
  'task:definitions': () => MOCK_TASK_DEFINITIONS,
  'task:run': (task: { taskKey: string }) => {
    if (runningTasks.has(task.taskKey)) {
      return { success: false, error: '任务正在运行中' } as const;
    }
    startMockRun(task.taskKey);
    return { success: true } as const;
  },
  'task:stop': (taskKey: string) => stopMockRun(taskKey),
  'task:running': () => [...runningTasks.keys()],
  'tasks:check-missed': () => [],
  'log:load': () => logs,
  'log:renderer-error': (payload: { message?: string; detail?: string }) => {
    appendLog('__system__', 'ERROR', payload.message ?? '未知错误', true, payload.detail);
  },

  'accounts:list': () => accounts,
  // 演示模式固定账号，UI 无添加入口（__WEB_DEMO__）；实现保留以维持 IPC 契约完整
  'accounts:add': async (credentials: { username: string; password: string }) => {
    // 模拟登录请求耗时，演示模式下任何用户名密码均登录成功
    await delay(randomInt(600, 1200));
    void credentials.password;
    const info = createAccount(credentials.username);
    accounts = [info, ...accounts];
    return info;
  },
  // 删除仅当前会话生效，刷新后恢复默认演示账号
  'accounts:remove': (accountId: string) => {
    accounts = accounts.filter((account) => account.id !== accountId);
  },
  // 默认账号切换仅当前会话生效，刷新后恢复 BearBot
  'accounts:set-default': (accountId: string) => {
    const idx = accounts.findIndex((account) => account.id === accountId);
    if (idx > 0) {
      const next = [...accounts];
      const [target] = next.splice(idx, 1);
      next.unshift(target);
      accounts = next;
    }
  },
} as const satisfies {
  [C in IpcInvokeChannel]: (...args: IpcInvokeArgs<C>) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
};

/**
 * 安装网页演示模式的 IPC 模拟实现
 *
 * 仅在 window.ipcRenderer 不存在（无 Electron preload）时生效；
 * 由 src/mocks/install.ts 在应用主入口之前调用。
 */
export function installIpcMock(): void {
  if (window.ipcRenderer) {
    return;
  }

  const api: IpcRendererApi = {
    on: <C extends IpcEventChannel>(channel: C, listener: (...args: IpcEventMap[C]) => void) => {
      const set = listeners[channel];
      const wrapped = listener as (...args: unknown[]) => void;
      set.add(wrapped);
      return () => set.delete(wrapped);
    },
    invoke: async <C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeArgs<C>) => {
      const handler = invokeHandlers[channel] as (...handlerArgs: unknown[]) => IpcInvokeResult<C>;
      // 预览必须在原始点击调用栈内打开窗口，否则浏览器会拦截异步弹窗。
      if (channel !== 'settings:preview-image') {
        await delay(randomInt(100, 300));
      }
      return handler(...args);
    },
  };

  window.ipcRenderer = api;
  appendLog('__system__', 'INFO', '网页演示模式：所有数据均为前端模拟，不产生真实请求', true);
}
