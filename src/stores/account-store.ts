import { create } from 'zustand';
import type { Account } from '@shared/types';

interface AccountStore {
  /** 已登录/已保存的账号列表（有序，首项为默认账号） */
  accounts: Account[];
  /** 是否已从主进程加载 */
  loaded: boolean;
  /** 添加账号请求中 */
  loading: boolean;
  /** 从主进程加载账号列表（含登录态） */
  loadAccounts: () => Promise<void>;
  /** 添加账号（登录），成功后更新列表 */
  addAccount: (username: string, password: string) => Promise<void>;
  /** 删除账号（退出登录并移除） */
  removeAccount: (accountId: string) => Promise<void>;
  /** 将指定账号置为默认（移到列表首位） */
  setDefaultAccount: (accountId: string) => Promise<void>;
}

/** 将新账号信息 upsert 进列表（已存在则替换，否则追加） */
function upsertAccount(accounts: Account[], info: Account): Account[] {
  const idx = accounts.findIndex((a) => a.id === info.id);
  if (idx >= 0) {
    const next = [...accounts];
    next[idx] = info;
    return next;
  }
  return [...accounts, info];
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  loaded: false,
  loading: false,

  loadAccounts: async () => {
    const list = await window.ipcRenderer.invoke('accounts:list');
    set({ accounts: list ?? [], loaded: true });
  },

  addAccount: async (username, password) => {
    set({ loading: true });
    try {
      const info = await window.ipcRenderer.invoke('accounts:add', { username, password });
      set({ accounts: upsertAccount(get().accounts, info), loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  removeAccount: async (accountId) => {
    await window.ipcRenderer.invoke('accounts:remove', accountId);
    set({ accounts: get().accounts.filter((a) => a.id !== accountId) });
  },

  setDefaultAccount: async (accountId) => {
    await window.ipcRenderer.invoke('accounts:set-default', accountId);
    const accounts = get().accounts;
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx <= 0) {
      return;
    }
    const next = [...accounts];
    const [target] = next.splice(idx, 1);
    next.unshift(target);
    set({ accounts: next });
  },
}));
