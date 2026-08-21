import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { pick } from 'es-toolkit';
import type { SettingsData } from '@shared/types';
import { createDefaultSettings } from '@shared/settings';

/** 渲染进程初始设置，与主进程 electron-store 共用同一默认值工厂 */
const DEFAULT_SETTINGS = createDefaultSettings(__APP_VERSION__);

/** 全部设置字段键名（由默认值对象派生，新增字段自动纳入） */
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsData)[];

/** 各设置字段的 setter 集合，成员名由字段名派生（uiFont -> setUiFont），值类型与字段一致 */
type SettingsSetters = {
  [K in keyof SettingsData as `set${Capitalize<K & string>}`]: (value: SettingsData[K]) => void;
};

/** 应用设置状态（数据字段继承 SettingsData，附加各字段 setter） */
type SettingsStore = SettingsData & SettingsSetters;

/** 持久化存储适配器，让 persist 支持 electron-store 的持久化存储 */
const ipcStorage: PersistStorage<SettingsData> = {
  getItem: async () => {
    const data = await window.ipcRenderer.invoke('settings:get');
    if (!data) {
      return null;
    }
    return { state: data, version: 0 };
  },
  setItem: async (_name, value) => {
    await window.ipcRenderer.invoke('settings:patch', value.state);
  },
  // 暂无清空设置功能，保留空方法用于满足接口
  removeItem: () => {},
};

/**
 * 为每个设置字段生成 `setXxx` 形式的 setter
 *
 * 成员名派生规则与 {@link SettingsSetters} 一致（set 前缀 + 字段名首字母大写），
 * 按默认值对象的键遍历生成，新增设置字段无需改动本文件。
 */
function createSetters(set: (partial: Partial<SettingsData>) => void): SettingsSetters {
  const result: Record<string, (value: unknown) => void> = {};
  for (const key of SETTING_KEYS) {
    result[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      set({ [key]: value } as Partial<SettingsData>);
    };
  }
  return result as SettingsSetters;
}

/**
 * 应用设置状态管理
 *
 * 通过 zustand/persist 中间件与主进程 electron-store 同步：
 * - 启动时从 electron-store 加载已保存的设置
 * - 设置变更时自动写入 electron-store
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      ...createSetters(set),
    }),
    {
      name: 'bearbot-settings',
      storage: ipcStorage,
      // 仅持久化数据字段（排除 setter），字段键名由默认值对象派生
      partialize: (state): SettingsData => pick(state, SETTING_KEYS),
    },
  ),
);
