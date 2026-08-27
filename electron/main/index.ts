import { app, shell, ipcMain, Menu, dialog, Notification } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import type { LogLevel, TaskLogEvent } from '@shared/types';
import {
  assertValidIpcInvokeArgs,
  type IpcEventChannel,
  type IpcEventMap,
  type IpcInvokeArgs,
  type IpcInvokeChannel,
  type IpcInvokeResult,
  type RendererErrorPayload,
} from '../../shared/ipc';
import {
  getAllSettings,
  patchSettings,
  getStorePath,
  getTaskConfigStore,
  setTaskConfigStore,
  getAllTaskRuns,
  getLastAliveAt,
  touchLastAliveAt,
} from '../services/store';
import { getTaskDefinitions } from '../services/tasks/registry';
import { runTask, stopTask, getRunningTasks } from '../services/tasks/runner';
import { getMissedTaskRuns } from '../services/tasks/missed-check';
import { scheduler } from '../services/tasks/scheduler';
import { initLogger, appendLog, loadRecentLogs } from '../services/logger';
import type { TaskRunCallbacks } from '../services/tasks/types';
import {
  initAccounts,
  getAccountInfos,
  addAccount,
  removeAccount,
  setDefaultAccount,
} from '../services/accounts';
import {
  APP_ID,
  createWindow,
  getMainWindow,
  isQuittingFlag,
  markQuitting,
  showMainWindow,
} from './window';
import { initTray, rebuildTrayMenu, destroyTray } from './tray';
import { IMAGE_EXTENSIONS_FILTER, registerLocalFileProtocol, registerLocalFileScheme } from './local-file-protocol';

/** 本次主进程生命周期内是否已执行过关闭期间错过检查 */
let startupMissedCheckDone = false;

/** IPC 主进程处理器签名 */
type IpcHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;

/** 注册带有共享参数校验的 IPC 处理器 */
function handleIpc<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertValidIpcInvokeArgs(channel, args);
    return handler(event, ...args as IpcInvokeArgs<C>);
  });
}

// 设置 Windows 10+ 通知的应用名称
if (process.platform === 'win32') { app.setAppUserModelId(APP_ID); }

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/** 向当前渲染窗口发送带有共享载荷类型的 IPC 事件 */
function sendToRenderer<C extends IpcEventChannel>(channel: C, ...args: IpcEventMap[C]): void {
  getMainWindow()?.webContents.send(channel, ...args);
}

/**
 * 构造系统级日志（taskKey 固定 `__system__`）并附加事件标识与时间后持久化、推送渲染进程
 *
 * 主进程致命错误、设置校验警告、渲染进程错误上报等系统链路统一走此函数，
 * 与任务日志（taskCallbacks.sendLog）共用 task:log 通道与日志文件。
 */
function sendSystemLog(level: LogLevel, message: string, detail?: string): void {
  const entry: TaskLogEvent = {
    level,
    taskKey: '__system__',
    message,
    system: true,
    eventId: randomUUID(),
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    ...(detail ? { detail } : {}),
  };
  appendLog(entry);
  sendToRenderer('task:log', entry);
}

/** 记录致命错误到控制台、日志文件与渲染进程 */
function logFatalError(source: string, err: unknown): void {
  const detail = err instanceof Error ? err.stack ?? undefined : undefined;
  const message = err instanceof Error ? err.message : String(err);
  console.error(source, message, detail ?? '');
  try {
    sendSystemLog('ERROR', `${source}：${message}`, detail);
  } catch {
    // logger 可能未就绪
  }
}

// 全局异常兜底：应用长期后台常驻，未捕获异常与未处理 rejection 仅记录日志而不退出进程，
// 避免单次任务/请求异常导致整个应用与调度器中断
process.on('uncaughtException', (err) => logFatalError('未捕获异常', err));
process.on('unhandledRejection', (reason) => logFatalError('未处理的 Promise rejection', reason));

app.on('before-quit', () => {
  markQuitting();
});

// 应用退出时销毁托盘图标与任务调度
app.on('will-quit', () => {
  // 记录退出时间作为应用最后存活时间，供下次启动时判定任务在关闭期间的错过执行
  touchLastAliveAt();
  destroyTray();
  scheduler.clear();
});

// 须在 app ready 前注册特权协议（模块顶层执行）
registerLocalFileScheme();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  registerLocalFileProtocol();

  // 创建系统托盘（含初始右键菜单，点击托盘恢复主窗口）
  initTray();

  // 首次运行无存活记录时以启动时间为基准，避免从未执行的任务被误判为关闭期间错过
  if (getLastAliveAt() === 0) {
    touchLastAliveAt();
  }

  // 初始化账号管理器：为每个已持久化账号创建分区运行态与 cookie 改写
  initAccounts();
  // 初始化日志系统：创建目录并清理超过保留期的日志文件
  initLogger();

  // #region 进程间通信

  // 设置持久化
  handleIpc('settings:get', () => getAllSettings()); // 获取设置
  handleIpc('settings:patch', (_event, data) => { // 写入设置
    const rejected = patchSettings(data);
    if (rejected.length > 0) {
      // 写入的设置校验失败时作为系统警告日志推送到渲染进程界面并持久化
      sendSystemLog('WARN', `以下设置项因校验失败被忽略：${rejected.join('、')}`);
    }
  });
  handleIpc('settings:open-dir', () => shell.openPath(path.dirname(getStorePath())));
  handleIpc('settings:select-image', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择背景图片',
      filters: [
        { name: '图片文件', extensions: IMAGE_EXTENSIONS_FILTER },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
  handleIpc('settings:preview-image', (_event, filePath) => {
    shell.openPath(filePath);
  });

  // 任务配置持久化
  handleIpc('task-config:get', () => getTaskConfigStore());
  handleIpc('task-config:set', (_event, data) => {
    setTaskConfigStore(data);
    // 写入后联动更新调度器，保证主进程状态与配置一致
    scheduler.applyConfigs(data.configs);
  });

  // 任务执行记录持久化
  handleIpc('task-runs:get', () => getAllTaskRuns());

  // 从主进程注册表获取任务定义元数据
  handleIpc('task:definitions', () => getTaskDefinitions());

  // 任务执行：在主进程跑任务，日志通过 task:log、状态通过 task:status、执行记录通过 task:run-record 推送到渲染进程
  const taskCallbacks: TaskRunCallbacks = {
    sendLog: (payload) => {
      // 附加时间戳后持久化并推送，保证文件与渲染进程展示的时间一致
      const entry = {
        ...payload,
        eventId: randomUUID(),
        time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      };
      appendLog(entry);
      sendToRenderer('task:log', entry);
    },
    sendStatus: (payload) => sendToRenderer('task:status', payload),
    sendRunRecord: (record) => sendToRenderer('task:run-record', record),
  };
  handleIpc('task:run', (_event, { taskKey }) =>
    runTask(taskKey, taskCallbacks),
  );
  // 任务停止：触发取消信号，中断 sleep 并在任务脚本检查点退出
  handleIpc('task:stop', (_event, taskKey) => stopTask(taskKey));
  // 查询运行中的任务：窗口销毁重建后供渲染进程同步运行状态
  handleIpc('task:running', () => getRunningTasks());
  // 检查关闭期间错过的任务：仅在应用启动时执行一次，从托盘恢复不执行
  handleIpc('tasks:check-missed', () => {
    if (startupMissedCheckDone) {
      return [];
    }
    startupMissedCheckDone = true;
    return getMissedTaskRuns();
  });

  // 日志加载：启动时从持久化文件加载最近 50 条（少于 logStore 上限以加快启动，会话内仍可累计至上限）
  handleIpc('log:load', () => loadRecentLogs(50));
  // 渲染进程错误上报：渲染侧的 ErrorBoundary 与全局 unhandledrejection/error 通过此通道，
  // 复用系统日志链路持久化到文件并推送回日志面板，与主进程 logFatalError 对齐
  handleIpc('log:renderer-error', (_event, payload: RendererErrorPayload) => {
    sendSystemLog(
      'ERROR',
      typeof payload?.message === 'string' ? payload.message : '未知渲染进程错误',
      typeof payload?.detail === 'string' ? payload.detail : undefined,
    );
  });

  // 初始化任务调度器：注入回调集合并加载已保存的配置
  scheduler.setCallbacks(taskCallbacks);
  scheduler.applyConfigs(getTaskConfigStore().configs);

  // 萌百多账号管理，每账号独立 session 分区隔离 cookie
  handleIpc('accounts:list', () => getAccountInfos());
  handleIpc('accounts:add', async (_event, { username, password }) => {
    const info = await addAccount(username, password);
    rebuildTrayMenu();
    return info;
  });
  handleIpc('accounts:remove', async (_event, accountId) => {
    await removeAccount(accountId);
    rebuildTrayMenu();
  });
  handleIpc('accounts:set-default', (_event, accountId) => {
    setDefaultAccount(accountId);
    rebuildTrayMenu();
  });

  // #endregion

  createWindow();

  // Windows 通知中心点击任务完成通知时恢复主窗口。
  // handleActivation 是官方推荐的集中式激活处理，覆盖实例 click 事件不可达的场景
  // （Notification 对象被 GC、通知持久化在通知中心等），与 second-instance 双保险；
  // 注册在建窗之后，避免冷启动（由通知点击拉起）时回调立即触发导致重复建窗。
  if (process.platform === 'win32') {
    Notification.handleActivation(() => showMainWindow());
  }
}).catch((err) => {
  // 初始化流程（协议注册、账号/日志/调度器初始化、IPC handler 注册、建窗）中断会使应用停在半初始化状态，
  // 表现为界面无响应；此处记录致命错误并弹窗告知后退出，避免留下不可用的僵死进程
  logFatalError('应用初始化失败', err);
  const message = err instanceof Error ? err.message : String(err);
  dialog.showErrorBox('应用初始化失败', `${message}\n\n应用将退出。`);
  app.quit();
});

app.on('window-all-closed', () => {
  // 最小化到托盘模式下，销毁窗口不退出应用，保持托盘常驻
  if (!isQuittingFlag() && getAllSettings().closeBehavior === 'minimize') {
    return;
  }
  if (process.platform !== 'darwin') { app.quit(); }
});

// 保持单例：第二次实例启动（含点击 Windows 通知）时恢复主窗口
app.on('second-instance', () => {
  showMainWindow();
});

app.on('activate', () => {
  showMainWindow();
});
