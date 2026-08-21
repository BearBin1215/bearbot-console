import type {
  TaskLogPayload,
  TaskParamValues,
  TaskRunRecord,
  TaskStatusPayload,
} from '@shared/types';
import type { MoegirlApi } from '../moegirl';
import type { TaskUser } from '../accounts';

/**
 * 任务日志接口
 *
 * source（来源/任务名）由 runner 注入，执行函数只关心 message。
 * detail 用于携带请求/响应等结构化诊断信息，持久化到日志文件并在界面可折叠查看。
 */
export interface TaskLogger {
  log: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
  warn: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
}

/**
 * 任务执行上下文
 *
 * runner 在启动任务时注入，供执行函数与外界交互
 */
export interface TaskContext {
  /** 执行该任务所绑定账号的主站 MoegirlApi 实例 */
  api: MoegirlApi;
  /** 执行该任务所绑定账号的共享站 MoegirlApi 实例 */
  commonsApi: MoegirlApi;
  /** 任务日志接口，支持写入 `[[内链]]、'''加粗'''、''斜体''` 以调整日志显示 */
  logger: TaskLogger;
  /** 当前账号的用户信息（类似 mw.user，提供 getId/getUser 与带缓存的 getRights/getGroups） */
  user: TaskUser;
  /** 任务参数（已合并注册表默认值与用户输入，仅含注册表声明的字段） */
  params: TaskParamValues;
  /** 任务取消信号，手动停止时触发；萌百 API 请求与 sleep 会自动响应中止，其他网络请求和纯 CPU 循环可调用 throwIfAborted() 提前退出 */
  signal: AbortSignal;
  /** 可取消的延时，被取消时抛出 AbortError；用于替代不可中断的 setTimeout */
  sleep: (ms: number) => Promise<void>;
}

/** 任务执行函数（任务体逻辑） */
export type TaskHandler = (ctx: TaskContext) => Promise<void>;

/**
 * 任务运行时回调集合
 *
 * runner 在执行过程中通过这些回调将日志、状态、执行记录推送到渲染进程。
 * 调用方（IPC handler、scheduler）组装后传入，runner 内部不再关心推送目标。
 */
export interface TaskRunCallbacks {
  /** 日志推送回调，将日志推送到渲染进程 LogPanel */
  sendLog: (payload: TaskLogPayload) => void;
  /** 状态推送回调，任务开始/结束时通知渲染进程切换按钮状态 */
  sendStatus: (payload: TaskStatusPayload) => void;
  /** 执行记录推送回调，任务结束时推送本次执行结果用于统计展示 */
  sendRunRecord: (record: TaskRunRecord) => void;
}
