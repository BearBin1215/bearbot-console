/**
 * 持久化存储服务
 *
 * 基于 electron-store 封装应用各类持久化数据的读写接口，主进程通过本模块统一管理磁盘状态。
 * 渲染进程通过 IPC 调用本模块完成数据存取，不直接操作 electron-store 实例。
 */
import Store from 'electron-store';
import type {
  AccountRecord,
  SettingsData,
  TaskConfig,
  TaskConfigStoreData,
  TaskRunRecord,
  UserInfo,
} from '@shared/types';
import { createDefaultSettings } from '@shared/settings';


// #region 应用设置

/** 应用设置默认值 */
const SETTINGS_DEFAULTS: SettingsData = createDefaultSettings(__APP_VERSION__);

/** 设置校验 */
const SETTINGS_VALIDATORS: Record<keyof SettingsData, (v: unknown) => boolean> = {
  uiFont: (v) => typeof v === 'string',
  codeFont: (v) => typeof v === 'string',
  backgroundOpacity: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  backgroundInterval: (v) => typeof v === 'number' && v >= 0,
  backgroundMode: (v) => v === 'sequential' || v === 'random',
  backgroundFadeDuration: (v) => typeof v === 'number' && v >= 0,

  moegirlDomain: (v) => v === 'mzh.moegirl.org.cn' || v === 'zh.moegirl.org.cn',
  userAgent: (v) => typeof v === 'string',
  retryCount: (v) => typeof v === 'number' && v >= 0 && Number.isInteger(v),
  retryInterval: (v) => typeof v === 'number' && v >= 0,
  requestTimeout: (v) => typeof v === 'number' && v > 0,
  minRequestInterval: (v) => typeof v === 'number' && v >= 0,
  backgroundImages: (v) => Array.isArray(v),

  closeBehavior: (v) => v === 'minimize' || v === 'exit',
  notifyOnTaskComplete: (v) => typeof v === 'boolean',
};

const settingsStore = new Store<SettingsData>({
  name: 'settings',
  defaults: SETTINGS_DEFAULTS,
});

/** 读取全部设置 */
export function getAllSettings(): SettingsData {
  return settingsStore.store;
}

/** 获取设置文件路径（settings.json） */
export function getStorePath(): string {
  return settingsStore.path;
}

/**
 * 合并写入部分设置，仅写入通过 {@link SETTINGS_VALIDATORS} 校验的已知字段，未知字段与校验失败的字段忽略并返回错误
 * @returns 被忽略的字段键名列表，供 settings:patch 记录错误输出日志
 */
export function patchSettings(data: Partial<SettingsData>): string[] {
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key in SETTINGS_VALIDATORS && SETTINGS_VALIDATORS[key as keyof SettingsData](value)) {
      settingsStore.set(key, value);
    } else {
      rejected.push(key);
    }
  }
  return rejected;
}

// #endregion


// #region 账号

const accountStore = new Store<{ accounts: AccountRecord[] }>({
  name: 'accounts',
  defaults: { accounts: [] },
});

/** 读取全部账号记录（有序，首项为默认账号） */
export function getAllAccounts(): AccountRecord[] {
  return accountStore.get('accounts');
}

/** 写入全部账号记录 */
export function setAllAccounts(accounts: AccountRecord[]): void {
  accountStore.set('accounts', accounts);
}

/** 按 accountId 索引的用户信息缓存 */
const userStore = new Store<Record<string, UserInfo>>({
  name: 'user-info',
  defaults: {},
});

/** 空的用户信息结构（无缓存时返回，调用方均以展开方式消费，不直接修改） */
const EMPTY_USER_INFO: UserInfo = {
  groups: [],
  rights: [],
  displayname: null,
  displaytag: null,
};

/** 读取指定账号的用户信息（无缓存时返回空） */
export function getUserInfo(accountId: string): UserInfo {
  if (!userStore.has(accountId)) {
    return EMPTY_USER_INFO;
  }
  return userStore.get(accountId);
}

/** 写入指定账号的用户信息 */
export function setUserInfo(accountId: string, data: UserInfo): void {
  userStore.set(accountId, data);
}

/** 删除指定账号的用户信息缓存 */
export function removeUserInfo(accountId: string): void {
  userStore.delete(accountId);
}

// #endregion


// #region 应用运行状态

/** 应用运行状态（记录应用最后存活时间，供错过任务检查判定关闭窗口） */
const appStateStore = new Store<{ lastAliveAt: number }>({
  name: 'app-state',
  defaults: { lastAliveAt: 0 },
});

/** 读取应用最后存活时间（毫秒时间戳，无记录时为 0） */
export function getLastAliveAt(): number {
  return appStateStore.get('lastAliveAt');
}

/** 记录应用最后存活时间为当前时间 */
export function touchLastAliveAt(): void {
  appStateStore.set('lastAliveAt', Date.now());
}

// #endregion


// #region 任务配置

const taskStore = new Store<TaskConfigStoreData>({
  name: 'task-config',
  defaults: { order: [], configs: {} },
});

/** 读取任务配置持久化数据（order + configs） */
export function getTaskConfigStore(): TaskConfigStoreData {
  return taskStore.store;
}

/** 写入任务配置持久化数据（全量替换 order + configs） */
export function setTaskConfigStore(data: TaskConfigStoreData): void {
  taskStore.store = data;
}

/** 读取单个任务配置（供 runner 按 taskKey 查询） */
export function getTaskConfig(taskKey: string): TaskConfig | undefined {
  return taskStore.get('configs')[taskKey];
}

// #endregion


// #region 任务执行记录

const taskRunStore = new Store<{ records: TaskRunRecord[] }>({
  name: 'task-runs',
  defaults: { records: [] },
});

/** 任务执行记录保留天数（超过自动清理） */
const TASK_RUN_RETENTION_DAYS = 90;

/** 清理超过保留期的任务执行记录 */
function pruneTaskRuns(records: TaskRunRecord[]): TaskRunRecord[] {
  const cutoff = Date.now() - TASK_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return records.filter((r) => r.endTime >= cutoff);
}

/** 读取全部任务执行记录（同时清理过期记录并回写磁盘） */
export function getAllTaskRuns(): TaskRunRecord[] {
  const records = pruneTaskRuns(taskRunStore.get('records'));
  taskRunStore.set('records', records);
  return records;
}

/** 添加一条任务执行记录（同时清理过期记录） */
export function addTaskRun(record: TaskRunRecord): void {
  const records = pruneTaskRuns([...taskRunStore.get('records'), record]);
  taskRunStore.set('records', records);
}

// #endregion
