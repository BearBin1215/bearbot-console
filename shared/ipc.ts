/**
 * 主进程、Preload 与渲染进程共用的 IPC 契约
 *
 * 新增或修改 IPC 通道时统一在此维护参数、返回值和事件载荷，避免三端分别声明后发生漂移。
 */
import type {
  Account,
  MissedTaskInfo,
  SettingsData,
  TaskConfig,
  TaskConfigStoreData,
  TaskDefinition,
  TaskKeyed,
  TaskLogEvent,
  TaskParamValues,
  TaskRunRecord,
  TaskRunResult,
  TaskStatusPayload,
} from './types';

/** 渲染进程错误上报载荷 */
export interface RendererErrorPayload {
  /** 错误摘要 */
  message?: string;
  /** 错误堆栈或其他诊断信息 */
  detail?: string;
}

/** 渲染进程调用主进程的通道契约 */
export interface IpcInvokeMap {
  'settings:get': { args: []; result: SettingsData };
  'settings:patch': { args: [data: Partial<SettingsData>]; result: void };
  'settings:open-dir': { args: []; result: string };
  'settings:select-image': { args: []; result: string | null };
  'settings:preview-image': { args: [filePath: string]; result: void };

  'task-config:get': { args: []; result: TaskConfigStoreData };
  'task-config:set': { args: [data: TaskConfigStoreData]; result: void };
  'task-runs:get': { args: []; result: TaskRunRecord[] };
  'task:definitions': { args: []; result: TaskDefinition[] };
  'task:run': { args: [task: TaskKeyed]; result: TaskRunResult };
  'task:stop': { args: [taskKey: string]; result: void };
  'task:running': { args: []; result: string[] };
  'tasks:check-missed': { args: []; result: MissedTaskInfo[] };
  'log:load': { args: []; result: TaskLogEvent[] };
  'log:renderer-error': { args: [payload: RendererErrorPayload]; result: void };

  'accounts:list': { args: []; result: Account[] };
  'accounts:add': { args: [credentials: { username: string; password: string }]; result: Account };
  'accounts:remove': { args: [accountId: string]; result: void };
  'accounts:set-default': { args: [accountId: string]; result: void };
}

/** 主进程推送到渲染进程的事件契约 */
export interface IpcEventMap {
  'task:log': [payload: TaskLogEvent];
  'task:status': [payload: TaskStatusPayload];
  'task:run-record': [record: TaskRunRecord];
}

/** 可调用的 IPC 通道名称 */
export type IpcInvokeChannel = keyof IpcInvokeMap;

/** 可订阅的 IPC 事件名称 */
export type IpcEventChannel = keyof IpcEventMap;

/** 指定调用通道的参数元组 */
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeMap[C]['args'];

/** 指定调用通道的返回值 */
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeMap[C]['result'];

/** 渲染进程可访问的窄 IPC API */
export interface IpcRendererApi {
  /** 订阅主进程事件，返回取消订阅函数 */
  on<C extends IpcEventChannel>(channel: C, listener: (...args: IpcEventMap[C]) => void): () => void;
  /** 调用主进程处理器 */
  invoke<C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeArgs<C>): Promise<IpcInvokeResult<C>>;
}

/** Preload 允许调用的通道白名单 */
export const IPC_INVOKE_CHANNELS = [
  'settings:get',
  'settings:patch',
  'settings:open-dir',
  'settings:select-image',
  'settings:preview-image',
  'task-config:get',
  'task-config:set',
  'task-runs:get',
  'task:definitions',
  'task:run',
  'task:stop',
  'task:running',
  'tasks:check-missed',
  'log:load',
  'log:renderer-error',
  'accounts:list',
  'accounts:add',
  'accounts:remove',
  'accounts:set-default',
] as const satisfies readonly IpcInvokeChannel[];

/** Preload 允许订阅的事件白名单 */
export const IPC_EVENT_CHANNELS = [
  'task:log',
  'task:status',
  'task:run-record',
] as const satisfies readonly IpcEventChannel[];

/** 判断未知值是否为非数组对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断未知值是否为字符串数组 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 判断未知值是否为任务参数值集合 */
function isTaskParamValues(value: unknown): value is TaskParamValues {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((item) =>
    typeof item === 'string' || typeof item === 'number' || isStringArray(item),
  );
}

/** 判断未知值是否为单个任务配置 */
function isTaskConfig(value: unknown): value is TaskConfig {
  if (!isRecord(value) || typeof value.cron !== 'string' || typeof value.enabled !== 'boolean') {
    return false;
  }
  if (value.accountId !== undefined && typeof value.accountId !== 'string') {
    return false;
  }
  if (value.overrides !== undefined) {
    if (!isRecord(value.overrides)) {
      return false;
    }
    if (value.overrides.name !== undefined && typeof value.overrides.name !== 'string') {
      return false;
    }
    if (value.overrides.description !== undefined && typeof value.overrides.description !== 'string') {
      return false;
    }
  }
  return value.params === undefined || isTaskParamValues(value.params);
}

/** 判断未知值是否为完整任务配置存储数据 */
function isTaskConfigStoreData(value: unknown): value is TaskConfigStoreData {
  if (!isRecord(value) || !isStringArray(value.order) || !isRecord(value.configs)) {
    return false;
  }
  return Object.values(value.configs).every(isTaskConfig);
}

/** 校验 IPC 调用参数；非法参数在进入主进程业务处理前直接拒绝 */
export function assertValidIpcInvokeArgs(channel: IpcInvokeChannel, args: unknown[]): void {
  const noArgs = args.length === 0;
  let valid = false;
  switch (channel) {
    case 'settings:get':
    case 'settings:open-dir':
    case 'settings:select-image':
    case 'task-config:get':
    case 'task-runs:get':
    case 'task:definitions':
    case 'task:running':
    case 'tasks:check-missed':
    case 'log:load':
    case 'accounts:list':
      valid = noArgs;
      break;
    case 'settings:patch':
      valid = args.length === 1 && isRecord(args[0]);
      break;
    case 'settings:preview-image':
    case 'task:stop':
    case 'accounts:remove':
    case 'accounts:set-default':
      valid = args.length === 1 && typeof args[0] === 'string';
      break;
    case 'task-config:set':
      valid = args.length === 1 && isTaskConfigStoreData(args[0]);
      break;
    case 'task:run':
      valid = args.length === 1 && isRecord(args[0]) && typeof args[0].taskKey === 'string';
      break;
    case 'log:renderer-error':
      valid = args.length === 1 && isRecord(args[0])
        && (args[0].message === undefined || typeof args[0].message === 'string')
        && (args[0].detail === undefined || typeof args[0].detail === 'string');
      break;
    case 'accounts:add':
      valid = args.length === 1 && isRecord(args[0])
        && typeof args[0].username === 'string'
        && typeof args[0].password === 'string';
      break;
  }
  if (!valid) {
    throw new TypeError(`IPC 通道 ${channel} 的参数格式无效`);
  }
}
