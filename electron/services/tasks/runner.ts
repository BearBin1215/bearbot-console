import { Notification } from 'electron';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TaskRunRecord, TaskParamField, TaskParamValues, TaskRunResult } from '@shared/types';
import { getAllSettings, addTaskRun, getTaskConfig } from '../store';
import { checkLoginAccount, getApis, getDefaultAccount, createTaskUser } from '../accounts';
import { TASK_REGISTRY } from './registry';
import { MoegirlRequestError, abortSignalStorage, loggerStorage, type RequestErrorDetail } from '../moegirl';
import type { TaskContext, TaskRunCallbacks } from './types';

/** 正在执行中的任务 key -> 取消控制器映射，用于防重入检查与手动停止 */
const abortControllers = new Map<string, AbortController>();
/** 已经抢占执行权、但尚未完成账号校验的任务 key，用于覆盖首次 await 前的并发竞态 */
const taskLocks = new Set<string>();

/** 创建可取消的延时函数，signal 触发时 reject AbortError */
function createAbortableSleep(signal: AbortSignal): (ms: number) => Promise<void> {
  // timers/promises 原生处理定时器与 abort 监听器的对称清理
  return (ms: number) => sleep(ms, undefined, { signal });
}

/**
 * 发送任务执行结果的系统桌面通知
 *
 * 主进程通过 Electron 原生 Notification 推送；不支持的平台上静默跳过。
 * 仅在任务自然结束（成功/失败）时调用，手动停止不通知。
 * 通知点击由主进程的 Notification.handleActivation 统一处理（恢复主窗口）。
 *
 * @param taskName 任务显示名称
 * @param success 是否执行成功
 * @param errorMsg 失败时的错误信息
 */
function notifyTaskResult(taskName: string, success: boolean, errorMsg?: string): void {
  if (!Notification.isSupported()) {
    return;
  }
  const body = success
    ? `【${taskName}】执行完成`
    : `【${taskName}】执行失败：${errorMsg ?? '未知错误'}`;
  new Notification({ title: success ? '任务执行成功' : '任务执行失败', body }).show();
}

/** 将请求错误详情格式化为可读的多行文本，供日志记录 */
export function formatRequestErrorDetail(detail: RequestErrorDetail): string {
  const lines: string[] = [`请求：${detail.method}`];
  const entries = Object.entries(detail.requestParams);
  if (entries.length > 0) {
    lines.push('参数：');
    for (const [key, value] of entries) {
      lines.push(`  ${key}=${value}`);
    }
  }
  if (detail.status !== undefined) {
    lines.push(`响应：HTTP ${detail.status}`);
  }
  if (detail.responseBody !== undefined) {
    lines.push('响应体：');
    lines.push(detail.responseBody);
  }
  return lines.join('\n');
}

/**
 * 合并注册表参数默认值与用户输入
 *
 * 仅保留注册表声明的字段；用户输入为空时回退到字段默认值。
 * number 字段会将字符串输入转为数字（失败则回退默认值）。
 * 多值字段（multi-string、multi-select）为 string[]，过滤空项后为空数组则回退默认值。
 * select 字段过滤不在可选项中的值（注册表变更后旧配置失效时回退默认值）。
 */
export function resolveParams(
  fields: TaskParamField[] | undefined,
  userValues: TaskParamValues | undefined,
): TaskParamValues {
  // 注册表未声明参数字段时无需合并，直接返回空对象
  if (!fields || fields.length === 0) {
    return {};
  }
  const result: TaskParamValues = {};
  for (const field of fields) {
    /** 用户填写的原始值（未填写时为 undefined） */
    const raw = userValues?.[field.key];
    let value: number | string | string[] | undefined;
    /** 是否多值：multi-string 或 multi-select，值为 string[] */
    const isMulti = field.type === 'multi-string' || field.type === 'multi-select';
    // 解析用户输入为有效值，无效时保持 undefined 由后续统一回退默认值
    if (isMulti) {
      // 多值字段：过滤空项，为空则视为未输入
      const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];
      value = arr.length > 0 ? arr : undefined;
    } else if (field.type === 'number') {
      // number 字段：转为数字，NaN 或未输入视为无效
      const num = raw !== undefined && raw !== '' ? Number(raw) : NaN;
      value = Number.isNaN(num) ? undefined : num;
    } else if (raw !== undefined && raw !== '') {
      value = raw;
    }
    // select 字段：过滤不在可选项中的值，避免注册表变更后旧配置失效
    if ((field.type === 'select' || field.type === 'multi-select') && field.options && value !== undefined) {
      const validValues = new Set(field.options.map((o) => o.value));
      if (field.type === 'multi-select') {
        const filtered = (value as string[]).filter((v) => validValues.has(v));
        value = filtered.length > 0 ? filtered : undefined;
      } else if (!validValues.has(value as string)) {
        value = undefined;
      }
    }
    // 用户输入无效时统一回退默认值
    value ??= field.default;
    // default 未声明时 value 为 undefined，跳过该字段不写入结果
    if (value !== undefined) {
      result[field.key] = value;
    }
  }
  return result;
}

/**
 * 停止指定任务，触发该任务的取消信号：
 * - ctx.sleep 立即 reject
 * - 在飞的 MoegirlApi 请求立即中断（通过 abortSignalStorage 注入）
 * - 下一次 API 请求在发起前检测到中止并抛出 AbortError
 */
export function stopTask(taskKey: string): void {
  abortControllers.get(taskKey)?.abort();
}

/**
 * 获取正在执行的任务 key 列表，供渲染进程在窗口重建后同步运行状态，
 * 重开后通过此接口一次性获取主进程仍在运行的任务。
 */
export function getRunningTasks(): string[] {
  return [...abortControllers.keys()];
}

/** 完成账号校验、任务上下文创建与实际执行；调用前已由 {@link runTask} 抢占任务锁 */
async function executeTask(
  taskKey: string,
  callbacks: TaskRunCallbacks,
): Promise<TaskRunResult> {
  const { sendLog, sendStatus, sendRunRecord } = callbacks;

  // 解析执行账号：任务配置绑定 > 默认账号
  const config = getTaskConfig(taskKey);
  const accountId = config?.accountId ?? getDefaultAccount()?.id;
  if (!accountId) {
    return { success: false, error: '未登录' };
  }
  const apis = getApis(accountId);
  if (!apis) {
    return { success: false, error: '账号不存在' };
  }
  // 未登录时静默跳过
  const loginStatus = await checkLoginAccount(accountId);
  if (!loginStatus) {
    return { success: false, error: '账号未登录' };
  }

  const entry = TASK_REGISTRY[taskKey];
  const handler = entry?.handler;

  if (!handler) {
    const msg = `未知任务：${taskKey}`;
    sendLog({ level: 'ERROR', taskKey, message: msg });
    return { success: false, error: msg };
  }

  // 校验通过，准备任务环境并执行
  const controller = new AbortController();
  abortControllers.set(taskKey, controller);
  sendStatus({ taskKey, running: true });
  sendLog({ level: 'INFO', taskKey, message: `开始执行任务【${entry.defaultName}】`, system: true });

  const { api, commonsApi } = apis;
  /** 要注入到任务处理函数内部的上下文 */
  const ctx: TaskContext = {
    api,
    commonsApi,
    logger: {
      log: (message, detail) => sendLog({ level: 'INFO', taskKey, message, detail }),
      info: (message, detail) => sendLog({ level: 'INFO', taskKey, message, detail }),
      warn: (message, detail) => sendLog({ level: 'WARN', taskKey, message, detail }),
      error: (message, detail) => sendLog({ level: 'ERROR', taskKey, message, detail }),
    },
    user: createTaskUser(api, loginStatus.username, loginStatus.userId),
    params: resolveParams(entry.params, config?.params),
    signal: controller.signal,
    sleep: createAbortableSleep(controller.signal),
  };

  /** 记录任务开始时间 */
  const startTime = Date.now();
  /** 是否成功 */
  let success = false;
  /** 是否被中止 */
  let aborted = false;
  let errorMsg: string | undefined;
  try {
    // 注入取消信号与任务 logger 后开始执行，使请求层与 editPage 无需逐层显式传参
    await abortSignalStorage.run(controller.signal, () =>
      loggerStorage.run(ctx.logger, () => handler(ctx)),
    );
    success = true;
    sendLog({ level: 'INFO', taskKey, message: `【${entry.defaultName}】执行完成`, system: true });
    return { success: true };
  } catch (e) {
    // 以取消信号是否触发来判断是手动停止还是任务抛出错误
    if (controller.signal.aborted) {
      aborted = true;
      errorMsg = '任务被手动停止';
      sendLog({ level: 'WARN', taskKey, message: `【${entry.defaultName}】已手动停止`, system: true });
    } else {
      const err = e as Error;
      errorMsg = err?.message ?? String(e);
      // API 请求失败时携带请求/响应详情，持久化到日志文件并在界面可折叠查看
      const detail = err instanceof MoegirlRequestError ? formatRequestErrorDetail(err.detail) : undefined;
      sendLog({
        level: 'ERROR',
        taskKey,
        message: `【${entry.defaultName}】执行失败：${errorMsg}`,
        system: true,
        detail,
      });
    }
    return { success: false, error: errorMsg };
  } finally {
    abortControllers.delete(taskKey);
    sendStatus({ taskKey, running: false });
    // 持久化本次执行结果并通知渲染进程更新统计（无论成功失败或停止都记录）
    const record: TaskRunRecord = {
      taskKey,
      startTime,
      endTime: Date.now(),
      success,
      aborted,
      error: errorMsg,
    };
    addTaskRun(record);
    sendRunRecord(record);
    // 任务自然结束（成功/失败）且用户开启通知时，发送系统桌面通知；手动停止不通知
    if (!aborted && getAllSettings().notifyOnTaskComplete) {
      notifyTaskResult(entry.defaultName, success, errorMsg);
    }
  }
}

/**
 * 在主进程执行指定任务
 *
 * 同一任务正在执行时直接返回失败，避免并发执行。
 * 任务执行期间通过 AbortController 支持手动停止。
 *
 * @param taskKey 任务唯一标识
 * @param callbacks 推送回调集合（日志、状态、执行记录）
 */
export async function runTask(
  taskKey: string,
  callbacks: TaskRunCallbacks,
): Promise<TaskRunResult> {
  const { sendLog } = callbacks;

  // 必须在首次异步等待前抢占执行权，否则并发触发可能同时通过登录检查并重复执行任务
  if (taskLocks.has(taskKey)) {
    const msg = '任务正在执行中，已忽略本次触发';
    sendLog({ level: 'WARN', taskKey, message: msg });
    return { success: false, error: msg };
  }
  taskLocks.add(taskKey);
  try {
    return await executeTask(taskKey, callbacks);
  } finally {
    // 账号检查、上下文创建或任务执行任一阶段抛错时都必须释放锁
    taskLocks.delete(taskKey);
  }
}
