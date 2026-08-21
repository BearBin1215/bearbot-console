/**
 * 应用设置默认值
 *
 * 主进程和渲染进程共用此工厂，避免两边分别维护一份会逐渐漂移的默认配置。
 */
import type { SettingsData } from './types';

/** 创建应用设置默认值 */
export function createDefaultSettings(appVersion: string): SettingsData {
  return {
    uiFont: '',
    codeFont: '',
    backgroundImages: [],
    backgroundOpacity: 88,
    backgroundInterval: 600000,
    backgroundMode: 'sequential',
    backgroundFadeDuration: 1000,

    moegirlDomain: 'mzh.moegirl.org.cn',
    userAgent: `bearbot-console/${appVersion}`,
    retryCount: 1,
    retryInterval: 3000,
    requestTimeout: 30000,
    minRequestInterval: 0,

    closeBehavior: 'minimize',
    notifyOnTaskComplete: false,
  };
}
