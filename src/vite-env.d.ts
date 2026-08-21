/// <reference types="vite/client" />

/** 应用名称（由 vite define 注入） */
declare const __APP_NAME__: string;
/** 应用版本号（由 vite define 注入） */
declare const __APP_VERSION__: string;

interface Window {
  // 由 electron/preload/index.ts 暴露的窄 API（带通道白名单），而非完整 IpcRenderer
  ipcRenderer: import('@shared/ipc').IpcRendererApi;
}
