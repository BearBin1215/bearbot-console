import { describe, it, expect } from 'vitest';
import { displayLabel } from '../../src/lib/account';

// 测试 displayLabel 函数（账号显示标签生成）
describe('displayLabel', () => {
  // #region 有 displayname

  it('有 displayname 和 displaytag → 返回 displayname#displaytag', () => {
    const account = { username: 'user', displayname: '昵称', displaytag: '1234' };
    expect(displayLabel(account)).toBe('昵称#1234');
  });

  it('有 displayname 无 displaytag → 返回 displayname', () => {
    const account = { username: 'user', displayname: '昵称', displaytag: null };
    expect(displayLabel(account)).toBe('昵称');
  });

  // #endregion


  // #region 无 displayname（回退到 username）

  it('displayname 为 null → 回退到 username', () => {
    const account = { username: 'user', displayname: null, displaytag: null };
    expect(displayLabel(account)).toBe('user');
  });

  it('displayname 为空字符串 → 回退到 username', () => {
    // 空字符串是 falsy，if (account.displayname) 为 false
    const account = { username: 'user', displayname: '', displaytag: null };
    expect(displayLabel(account)).toBe('user');
  });

  // #endregion
});
