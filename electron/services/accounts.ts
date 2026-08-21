/**
 * 账号管理模块
 *
 * 管理萌娘百科多账号生命周期：登录、登出、状态检查、用户信息缓存与持久化
 *
 * 核心设计：
 * - **运行态与持久态分离**：AccountRecord 仅存于磁盘，AccountRuntime 仅存于内存，
 *   两者通过 ensureRuntime 按需绑定。进程重启后运行态重建，持久态自动加载。
 * - **多账号隔离**：每个账号拥有独立的 Electron Session（分区），承载各自的 cookie jar，避免多账号间的 cookie 冲突。
 * - **懒初始化**：`initAccounts` 仅创建分区和运行态，登录态在首次查询时按需推断。
 *
 * 导出的 API 按职责分层：
 * - 生命周期：{@link initAccounts}、{@link addAccount}、{@link removeAccount}
 * - 查询：{@link getAccountInfos}、{@link getDefaultAccount}、{@link getApis}、{@link checkLoginAccount}
 * - 设置：{@link setDefaultAccount}
 * - 任务上下文：{@link createTaskUser} 提供用户 ID/用户名查询与带缓存的权限/用户组查询
 */
import { session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Account, AccountRecord, UserInfo } from '@shared/types';
import {
  getAllAccounts,
  setAllAccounts,
  getAllSettings,
  getUserInfo,
  setUserInfo,
  removeUserInfo,
} from './store';
import { MoegirlApi } from './moegirl';

/** 分区名前缀，用于持久化分区，cookie 落盘 */
const PARTITION_PREFIX = 'persist:moegirl-';

/** 共享站域名 */
const COMMONS_HOST = 'commons.moegirl.org.cn';

/** 账号运行态：每个账号独立的 session 与主站/共享站 API 实例 */
interface AccountRuntime {
  /** 账号专属 session（分区），承载 cookie jar */
  session: Session;
  /** 绑定该 session 的主站 API 实例（mzh/zh） */
  api: MoegirlApi;
  /** 绑定该 session 的共享站 API 实例（commons） */
  commonsApi: MoegirlApi;
}

/** 各账号对应的运行态，键为id（uuid） */
const runtimes = new Map<string, AccountRuntime>();

/** 登录态信息（从 session cookie 读取） */
interface LoginStatus {
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  username: string;
}

// #region 内部工具

/** 为萌娘百科响应的`Set-Cookie`补`SameSite=None; Secure`以支持主进程请求各子站跨域携带 cookie */
function applyMoegirlCookieRewriting(targetSession: Session): void {
  targetSession.webRequest.onHeadersReceived(
    { urls: ['*://*.moegirl.org.cn/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      const setCookieKey = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie');
      if (setCookieKey) {
        headers[setCookieKey] = headers[setCookieKey].map((header) =>
          /samesite=/i.test(header) ? header : `${header}; SameSite=None; Secure`,
        );
      }
      callback({ responseHeaders: headers });
    },
  );
}

/** 为各账号创建运行态（分区 session + 主站、共享站 API），并挂载 cookie 改写 */
function ensureRuntime(id: string): AccountRuntime {
  let runtime = runtimes.get(id);
  if (runtime) {
    return runtime;
  }
  const ses = session.fromPartition(PARTITION_PREFIX + id);
  applyMoegirlCookieRewriting(ses);
  /** 主站API */
  const api = new MoegirlApi(ses);
  /** 共享站API */
  const commonsApi = new MoegirlApi(ses, COMMONS_HOST);
  runtime = {
    session: ses,
    api,
    commonsApi,
  };
  runtimes.set(id, runtime);
  return runtime;
}

/** 使用 `action=clientlogin` 登录，返回的 cookie 由该账号 session 自动保存 */
async function login(api: MoegirlApi, username: string, password: string): Promise<string> {
  const { moegirlDomain } = getAllSettings();

  const logintoken = await api.getToken('login');
  const data = await api.post({
    action: 'clientlogin',
    logintoken,
    loginreturnurl: `https://${moegirlDomain}/api.php`,
    username,
    password,
    rememberMe: '1',
  });

  const clientlogin = data?.clientlogin;
  if (clientlogin?.status === 'PASS') {
    return clientlogin.username || username;
  }

  let errorMessage = '登录失败';
  if (typeof clientlogin?.message === 'string' && clientlogin.message) {
    errorMessage = clientlogin.message;
  } else if (typeof data?.error?.info === 'string' && data.error.info) {
    errorMessage = data.error.info;
  } else if (typeof clientlogin?.status === 'string') {
    errorMessage = `登录失败（状态：${clientlogin.status}）`;
  }
  throw new Error(errorMessage);
}

/** 检查登录状态，从 cookie 读取用户名与用户 ID */
async function checkLogin(ses: Session): Promise<LoginStatus | null> {
  const userNameCookies = await ses.cookies.get({ name: 'moegirlSSOUserName' });
  const userIdCookies = await ses.cookies.get({ name: 'moegirlSSOUserID' });
  if (userNameCookies.length === 0 || userIdCookies.length === 0) {
    return null;
  }
  return {
    username: decodeURIComponent(userNameCookies[0].value),
    userId: userIdCookies[0].value,
  };
}

/** 获取当前登录账号的用户组、权限与显示昵称（从 session cookie 取 userId 后查询 list=users） */
async function fetchUserInfo(api: MoegirlApi): Promise<UserInfo> {
  const status = await checkLogin(api.session);
  if (!status) {
    throw new Error('未登录，无法获取用户信息');
  }
  const res = await api.get({
    action: 'query',
    list: 'users',
    usprop: ['groups', 'rights'],
    ususerids: status.userId,
  });
  const user = res?.query?.users?.[0];
  return {
    groups: user?.groups || [],
    rights: user?.rights || [],
    displayname: user?.displayname ?? null,
    displaytag: user?.displaytag ?? null,
  };
}

/** 退出登录：清除该账号 session 的 cookie 与 token 缓存 */
async function logout(api: MoegirlApi): Promise<void> {
  const allCookies = await api.session.cookies.get({ domain: 'moegirl.org.cn' });
  for (const cookie of allCookies) {
    const domain = (cookie.domain ?? '').replace(/^\./, '');
    const url = `https://${domain}${cookie.path}`;
    try {
      await api.session.cookies.remove(url, cookie.name);
    } catch {
      // 单个 cookie 删除失败静默跳过，继续清理其余 cookie，避免退出登录不彻底
    }
  }
  api.clearTokenCache();
}

/** 重新获取并返回指定账号的信息（用于登录刷新后） */
async function refreshAccountInfo(accountId: string): Promise<Account> {
  const records = getAllAccounts();
  const record = records.find((r) => r.id === accountId);
  const runtime = ensureRuntime(accountId);
  const status = await checkLogin(runtime.session);

  let userInfo = getUserInfo(accountId);
  if (status) {
    try {
      userInfo = await fetchUserInfo(runtime.api);
      setUserInfo(accountId, userInfo);
    } catch {
      // 用户信息获取失败静默跳过，不影响登录态
    }
    // 同步 userId 到持久化记录
    if (record && status.userId && record.userId !== status.userId) {
      const updated = records.map((r) => (r.id === accountId ? { ...r, userId: status.userId } : r));
      setAllAccounts(updated);
    }
  }
  return {
    id: accountId,
    username: record?.username ?? '',
    userId: status?.userId ?? record?.userId ?? null,
    loggedIn: status !== null,
    ...userInfo,
  };
}

// #endregion


// #region 生命周期

/**
 * 初始化账号管理器
 *
 * 启动时为每个已持久化的账号创建运行态（分区 + cookie 改写）。
 * 登录态在 {@link getAccountInfos} 时按需推断，此处不阻塞。
 */
export function initAccounts() {
  for (const record of getAllAccounts()) {
    ensureRuntime(record.id);
  }
}

/**
 * 添加账号，生成新 id、创建运行态并登录，登录成功后拉取用户信息并持久化。
 * 统一委托 {@link refreshAccountInfo} 完成 checkLogin、用户信息拉取与记录同步。
 *
 * @returns 登录成功后的账号信息
 */
export async function addAccount(username: string, password: string): Promise<Account> {
  const records = getAllAccounts();
  const id = randomUUID();
  const runtime = ensureRuntime(id);
  const name = await login(runtime.api, username, password);

  setAllAccounts([...records, { id, username: name, userId: null }]);
  return refreshAccountInfo(id);
}

/** 移除账号，清理本地数据 */
export async function removeAccount(accountId: string) {
  const runtime = runtimes.get(accountId);
  if (runtime) {
    await logout(runtime.api);
    // 移除运行态
    runtimes.delete(accountId);
  }
  // 清理 session 分区的磁盘存储（cookie、localStorage 等）
  await session.fromPartition(PARTITION_PREFIX + accountId).clearStorageData();
  // 删除用户信息缓存
  removeUserInfo(accountId);
  // 删除持久化记录
  setAllAccounts(getAllAccounts().filter((r) => r.id !== accountId));
}

// #endregion


// #region 查询

/** 移除失效账号的运行态、用户信息缓存与持久化记录（单次写盘） */
function removeStaleRecords(ids: string[]): void {
  const stale = new Set(ids);
  for (const id of ids) {
    runtimes.delete(id);
    removeUserInfo(id);
  }
  setAllAccounts(getAllAccounts().filter((r) => !stale.has(r.id)));
}

/**
 * 读取全部账号的完整信息（含登录态与用户信息）
 *
 * 检测到 cookie 丢失（登录态失效）的账号会被自动清理，不会出现在返回列表中
 */
export async function getAccountInfos(): Promise<Account[]> {
  // 浅拷贝脱离内部引用，避免遍历期间被 setDefaultAccount 的 splice/unshift 原地变更导致迭代错乱
  const records = [...getAllAccounts()];
  const infos: Account[] = [];
  /** cookie 丢失的账号 id，遍历结束后统一清理（避免逐个全量重写磁盘） */
  const staleIds: string[] = [];
  for (const record of records) {
    const runtime = ensureRuntime(record.id);
    const status = await checkLogin(runtime.session);
    if (!status) {
      staleIds.push(record.id);
      continue;
    }
    const userInfo = getUserInfo(record.id);
    infos.push({
      ...record,
      userId: status.userId,
      loggedIn: true,
      ...userInfo,
    });
  }
  if (staleIds.length > 0) {
    removeStaleRecords(staleIds);
  }
  return infos;
}

/** 默认账号（列表首项），无账号时返回 undefined */
export function getDefaultAccount(): AccountRecord | undefined {
  return getAllAccounts()[0];
}

/** 获取账号的主站与共享站 API 实例，账号不存在时为 undefined */
export function getApis(accountId: string): { api: MoegirlApi; commonsApi: MoegirlApi } | undefined {
  const runtime = runtimes.get(accountId);
  if (!runtime) {
    return undefined;
  }
  return { api: runtime.api, commonsApi: runtime.commonsApi };
}

/** 检查指定账号的登录态，账号不存在时返回 null */
export function checkLoginAccount(accountId: string): Promise<LoginStatus | null> {
  const runtime = runtimes.get(accountId);
  if (!runtime) {
    return Promise.resolve(null);
  }
  return checkLogin(runtime.session);
}

// #endregion


// #region 设置

/** 将指定账号置为默认（移到列表首位），已是默认账号或账号不存在时静默忽略。 */
export function setDefaultAccount(id: string) {
  const records = getAllAccounts();
  const idx = records.findIndex((r) => r.id === id);
  if (idx <= 0) {
    return;
  }
  const [target] = records.splice(idx, 1);
  records.unshift(target);
  setAllAccounts(records);
}

// #endregion


// #region 任务上下文

/**
 * 账号用户信息访问对象（大概类似 mw.user）
 *
 * getId/getUser 直接返回登录态中已知的用户 ID 与用户名；
 * groups 与 rights 共享同一次 `list=users` 请求：首次调用 getRights/getGroups 时请求并缓存，
 * 后续调用直接返回缓存。并发调用复用同一个进行中的请求；请求失败时不缓存，下次重新请求。
 */
export interface TaskUser {
  /** 获取当前账号的用户 ID */
  getId: () => string;
  /** 获取当前账号的用户名 */
  getUser: () => string;
  /** 获取当前账号的权限列表（有缓存则返回缓存，否则请求 users 接口） */
  getRights: () => Promise<string[]>;
  /** 获取当前账号的用户组列表（有缓存则返回缓存，否则请求 users 接口） */
  getGroups: () => Promise<string[]>;
}

/**
 * 创建账号用户信息访问对象供任务上下文注入
 *
 * getId/getUser 直接返回登录态中已知的值；
 * getRights/getGroups 有缓存数据时直接返回，无缓存时调用 users 接口获取并缓存。
 *
 * @param api 账号绑定的 API 实例
 * @param username 登录态用户名
 * @param userId 登录态用户 ID
 */
export function createTaskUser(api: MoegirlApi, username: string, userId: string): TaskUser {
  /** 成功获取后填充的缓存 */
  let cache: UserInfo | undefined;
  /** 进行中的请求（用于并发去重，完成后清空以便失败重试） */
  let pending: Promise<UserInfo> | undefined;

  const ensureUserRights = (): Promise<UserInfo> => {
    if (cache) {
      return Promise.resolve(cache);
    }
    if (!pending) {
      pending = fetchUserInfo(api)
        .then((result) => {
          cache = result;
          return result;
        })
        .finally(() => {
          pending = undefined;
        });
    }
    return pending;
  };

  return {
    getId: () => userId,
    getUser: () => username,
    getRights: async () => (await ensureUserRights()).rights,
    getGroups: async () => (await ensureUserRights()).groups,
  };
}

// #endregion
