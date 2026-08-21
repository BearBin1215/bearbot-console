/// <reference types="vite-plugin-electron/electron-env" />

/** 应用版本号（由 vite define 注入） */
declare const __APP_VERSION__: string;

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: 'true';
    APP_ROOT: string;
    VITE_PUBLIC: string;
  }
}
