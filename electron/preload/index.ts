import { ipcRenderer, contextBridge, type IpcRendererEvent } from 'electron';
import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  assertValidIpcInvokeArgs,
  type IpcEventChannel,
  type IpcEventMap,
  type IpcInvokeArgs,
  type IpcInvokeChannel,
  type IpcInvokeResult,
  type IpcRendererApi,
} from '@shared/ipc';

/** 判断通道是否在调用白名单中 */
function isInvokeChannel(channel: string): channel is IpcInvokeChannel {
  return (IPC_INVOKE_CHANNELS as readonly string[]).includes(channel);
}

/** 判断通道是否在事件订阅白名单中 */
function isEventChannel(channel: string): channel is IpcEventChannel {
  return (IPC_EVENT_CHANNELS as readonly string[]).includes(channel);
}

/** 订阅白名单内的主进程事件 */
function on<C extends IpcEventChannel>(
  channel: C,
  listener: (...args: IpcEventMap[C]) => void,
): () => void {
  if (!isEventChannel(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => {
    listener(...args as IpcEventMap[C]);
  };
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

/** 调用白名单内的主进程处理器，并在发送前校验参数结构 */
function invoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeArgs<C>
): Promise<IpcInvokeResult<C>> {
  if (!isInvokeChannel(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
  assertValidIpcInvokeArgs(channel, args);
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<C>>;
}

// 向渲染进程暴露可订阅事件和可调用方法
const api: IpcRendererApi = { on, invoke };
contextBridge.exposeInMainWorld('ipcRenderer', api);
