import { app, BrowserWindow, shell } from 'electron';
import windowStateKeeper from 'electron-window-state';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getAllSettings } from '../services/store';
import { setupDevToolsFont } from './devtools-font';

/** 应用唯一标识，与 electron-builder.json 的 appId 保持一致；用于 Windows 通知与安装快捷方式的关联 */
export const APP_ID = 'com.bearbin.bearbot-console';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '../..');

const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

const preload = path.join(__dirname, '../preload/index.mjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');

/** 是否已进入退出流程（区分“关闭窗口最小化到托盘”与“退出应用”） */
let isQuitting = false;

/** 主窗口实例；最小化到托盘销毁后为 null，下次显示时重建 */
let win: BrowserWindow | null = null;

/** 标记应用进入退出流程，此后关闭窗口将直接退出而不是最小化到托盘 */
export function markQuitting(): void {
  isQuitting = true;
}

/** 是否已进入退出流程 */
export function isQuittingFlag(): boolean {
  return isQuitting;
}

/** 获取主窗口实例；窗口已关闭或销毁时返回 null */
export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/**
 * 创建主窗口并加载渲染进程页面
 *
 * 窗口位置大小由 electron-window-state 持久化；开发模式加载 Vite dev server，生产加载打包产物。
 */
export function createWindow(): void {
  /** 保持窗口位置和大小 */
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 720,
  });

  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 960,
    minHeight: 540,
    useContentSize: true,
    title: app.getName(),
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.png'),
    thickFrame: true,
    // 隐藏默认标题栏，使用自定义组件覆盖
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#666666',
      height: 36,
    },
    webPreferences: {
      preload,
      contextIsolation: true,
    },
  });

  mainWindowState.manage(win);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // 开发模式下自动打开开发者工具，独立窗口
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(indexHtml);
  }

  // 所有链接在外部浏览器中打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) { shell.openExternal(url); }
    return { action: 'deny' };
  });

  // 关闭窗口时根据设置最小化到托盘或退出
  win.on('close', (e) => {
    const settings = getAllSettings();
    if (settings.closeBehavior === 'minimize' && !isQuitting) {
      e.preventDefault();
      // 销毁渲染窗口释放内存，任务调度在主进程继续运行，恢复显示时重建窗口
      win?.destroy();
      win = null;
    }
  });

  setupDevToolsFont(win.webContents);
}

/**
 * 显示并聚焦主窗口
 *
 * 窗口已销毁（最小化到托盘常驻）时先重建，最小化状态先恢复再聚焦。
 * 供托盘点击、通知点击与 second-instance 恢复窗口复用。
 */
export function showMainWindow(): void {
  if (!getMainWindow()) { createWindow(); }
  const current = getMainWindow();
  if (current?.isMinimized()) { current.restore(); }
  current?.show();
  current?.focus();
}
