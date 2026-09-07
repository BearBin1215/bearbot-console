/**
 * 主进程、Preload 与渲染进程共用的 IPC 契约
 *
 * 新增或修改 IPC 通道时统一在此维护参数、返回值和事件载荷，避免三端分别声明后发生漂移。
 */
import { z } from 'zod';
import type {
  Account,
  MissedTaskInfo,
  SettingsData,
  TaskConfigStoreData,
  TaskDefinition,
  TaskKeyed,
  TaskLogEvent,
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

/** 通道契约占位工具：仅在类型层面记录参数与返回值类型，运行时返回值无意义 */
function contract<A extends readonly unknown[], R>(): { args: A; result: R } {
  return undefined as never;
}

/** 渲染进程调用主进程的通道契约（值仅供类型推导，通道名与 Preload 白名单共用此单一来源） */
export const IPC_INVOKE_MAP = {
  'settings:get': contract<[], SettingsData>(),
  'settings:patch': contract<[Partial<SettingsData>], void>(),
  'settings:open-dir': contract<[], string>(),
  'settings:select-image': contract<[], string | null>(),
  'settings:preview-image': contract<[string], void>(),

  'task-config:get': contract<[], TaskConfigStoreData>(),
  'task-config:set': contract<[TaskConfigStoreData], void>(),
  'task-runs:get': contract<[], TaskRunRecord[]>(),
  'task:definitions': contract<[], TaskDefinition[]>(),
  'task:run': contract<[TaskKeyed], TaskRunResult>(),
  'task:stop': contract<[string], void>(),
  'task:running': contract<[], string[]>(),
  'tasks:check-missed': contract<[], MissedTaskInfo[]>(),
  'log:load': contract<[], TaskLogEvent[]>(),
  'log:renderer-error': contract<[RendererErrorPayload], void>(),

  'accounts:list': contract<[], Account[]>(),
  'accounts:add': contract<[{ username: string; password: string }], Account>(),
  'accounts:remove': contract<[string], void>(),
  'accounts:set-default': contract<[string], void>(),
} satisfies Record<string, { args: readonly unknown[]; result: unknown }>;

/** 渲染进程调用主进程的通道契约类型 */
export type IpcInvokeMap = typeof IPC_INVOKE_MAP;

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

/** Preload 允许调用的通道白名单（由通道契约派生，无需单独维护） */
export const IPC_INVOKE_CHANNELS = Object.keys(IPC_INVOKE_MAP) as IpcInvokeChannel[];

/** Preload 允许订阅的事件白名单 */
export const IPC_EVENT_CHANNELS = [
  'task:log',
  'task:status',
  'task:run-record',
] as const satisfies readonly IpcEventChannel[];

/** 渲染进程可访问的窄 IPC API */
export interface IpcRendererApi {
  /** 订阅主进程事件，返回取消订阅函数 */
  on<C extends IpcEventChannel>(channel: C, listener: (...args: IpcEventMap[C]) => void): () => void;
  /** 调用主进程处理器 */
  invoke<C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeArgs<C>): Promise<IpcInvokeResult<C>>;
}

// #region 调用参数校验

/** 任务参数值集合（键名 -> string/number/string[]） */
const taskParamValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.array(z.string())]),
);

/** 单个任务配置 */
const taskConfigSchema = z.object({
  cron: z.string(),
  enabled: z.boolean(),
  accountId: z.string().optional(),
  overrides: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  params: taskParamValuesSchema.optional(),
});

/** 任务配置持久化数据（order + configs） */
const taskConfigStoreDataSchema: z.ZodType<TaskConfigStoreData> = z.object({
  order: z.array(z.string()),
  configs: z.record(z.string(), taskConfigSchema),
});

/** 渲染进程错误上报载荷 */
const rendererErrorPayloadSchema: z.ZodType<RendererErrorPayload> = z.object({
  message: z.string().optional(),
  detail: z.string().optional(),
});

/** 各调用通道的参数元组校验 schema（键须覆盖全部通道，由 Record 注解在编译期保证） */
const INVOKE_ARGS: Record<IpcInvokeChannel, z.ZodType> = {
  'settings:get': z.tuple([]),
  'settings:patch': z.tuple([z.record(z.string(), z.unknown())]),
  'settings:open-dir': z.tuple([]),
  'settings:select-image': z.tuple([]),
  'settings:preview-image': z.tuple([z.string()]),

  'task-config:get': z.tuple([]),
  'task-config:set': z.tuple([taskConfigStoreDataSchema]),
  'task-runs:get': z.tuple([]),
  'task:definitions': z.tuple([]),
  'task:run': z.tuple([z.object({ taskKey: z.string() })]),
  'task:stop': z.tuple([z.string()]),
  'task:running': z.tuple([]),
  'tasks:check-missed': z.tuple([]),
  'log:load': z.tuple([]),
  'log:renderer-error': z.tuple([rendererErrorPayloadSchema]),

  'accounts:list': z.tuple([]),
  'accounts:add': z.tuple([z.object({ username: z.string(), password: z.string() })]),
  'accounts:remove': z.tuple([z.string()]),
  'accounts:set-default': z.tuple([z.string()]),
};

/** 校验 IPC 调用参数；非法参数在进入主进程业务处理前直接拒绝 */
export function assertValidIpcInvokeArgs(channel: IpcInvokeChannel, args: unknown[]): void {
  const result = INVOKE_ARGS[channel].safeParse(args);
  if (result.success) {
    return;
  }
  const issue = result.error.issues[0];
  /** 失败定位：有字段路径时显示 “字段路径：原因”，否则仅显示原因 */
  const detail = issue
    ? `（${issue.path.map(String).join('.')}${issue.path.length ? '：' : ''}${issue.message}）`
    : '';
  throw new TypeError(`IPC 通道 ${channel} 的参数格式无效${detail}`);
}

// #endregion
