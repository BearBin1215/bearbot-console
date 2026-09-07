/// <reference types="vite/client" />

/** 应用名称（由 vite define 注入） */
declare const __APP_NAME__: string;
/** 应用版本号（由 vite define 注入） */
declare const __APP_VERSION__: string;

interface Window {
  // 由 electron/preload/index.ts 暴露的窄 API（带通道白名单），而非完整 IpcRenderer
  ipcRenderer: import('@shared/ipc').IpcRendererApi;
}

/** Chromium 提供的 User-Agent 客户端提示接口（TS lib.dom 暂未收录） */
interface NavigatorUAData {
  /** 低熵平台标识，Windows 上固定为 'Windows' */
  platform: string;
  /** 异步读取高熵提示，如可区分 Windows 10/11 的 platformVersion */
  getHighEntropyValues(hints: string[]): Promise<Record<string, string>>;
}

interface Navigator {
  /** 仅 Chromium 浏览器（含 Electron 渲染进程）上存在 */
  readonly userAgentData?: NavigatorUAData;
}
