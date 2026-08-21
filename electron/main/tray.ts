/**
 * 系统托盘
 *
 * 管理托盘实例的创建、右键菜单重建与销毁。
 * 点击托盘恢复主窗口；账号变化时由 IPC 处理器调用 rebuildTrayMenu 更新菜单中的当前账号显示。
 */
import { app, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { getDefaultAccount } from '../services/accounts';
import { markQuitting, showMainWindow } from './window';

/** 系统托盘实例；销毁后为 null */
let tray: Tray | null = null;

/** 重建托盘右键菜单（账号变化时调用） */
export function rebuildTrayMenu(): void {
  const defaultAccount = getDefaultAccount();
  const loginLabel = defaultAccount ? `当前账号：${defaultAccount.username}` : '未登录';
  const contextMenu = Menu.buildFromTemplate([
    { label: loginLabel, enabled: false },
    { type: 'separator' },
    {
      label: '显示',
      click: () => {
        showMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        markQuitting();
        app.quit();
      },
    },
  ]);
  tray?.setContextMenu(contextMenu);
}

/** 创建系统托盘，注册点击行为并构建初始右键菜单 */
export function initTray(): void {
  const iconPath = path.join(process.env.VITE_PUBLIC, 'logo-tray.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip(app.getName());
  tray.on('click', () => {
    showMainWindow();
  });
  rebuildTrayMenu();
}

/** 销毁托盘并释放引用（应用退出时调用） */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
