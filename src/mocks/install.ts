/**
 * 网页演示模式的 mock 安装入口
 *
 * 由 vite.config.web.ts 的 transformIndexHtml 注入到 index.html，
 * 在应用主入口模块执行之前运行，保证渲染进程任何 IPC 调用发生前 mock 已就位。
 * Electron 环境下 preload 已暴露真实 IPC API，installIpcMock 内部会跳过安装。
 */
import { installIpcMock } from './ipc-mock';

installIpcMock();
