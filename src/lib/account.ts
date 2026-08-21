/**
 * 账号相关工具函数
 */
import type { Account } from '@shared/types';

/** 萌娘百科账号头像 URL（无 userId 时返回 undefined，由 Avatar 回退到图标） */
export function avatarUrl(userId: string | null): string | undefined {
  return userId ? `https://storage.moegirl.org.cn/moegirl/avatars/${userId}/latest.png` : undefined;
}

/**
 * 获取账号的显示标签
 *
 * 设置了昵称时返回 `displayname#displaytag`（displaytag 缺省时仅 displayname），
 * 未设置昵称时回退到 MediaWiki 用户名。
 */
export function displayLabel(account: Pick<Account, 'username' | 'displayname' | 'displaytag'>): string {
  if (account.displayname) {
    return account.displaytag ? `${account.displayname}#${account.displaytag}` : account.displayname;
  }
  return account.username;
}
