import { describe, expect, it } from 'vitest';
import { assertValidIpcInvokeArgs } from '@shared/ipc';

describe('assertValidIpcInvokeArgs', () => {
  it('接受无参数查询通道', () => {
    expect(() => assertValidIpcInvokeArgs('settings:get', [])).not.toThrow();
  });

  it('拒绝查询通道携带多余参数', () => {
    expect(() => assertValidIpcInvokeArgs('settings:get', [{}])).toThrow('参数格式无效');
  });

  it('接受结构正确的任务配置', () => {
    expect(() => assertValidIpcInvokeArgs('task-config:set', [{
      order: ['task-a'],
      configs: {
        'task-a': {
          cron: '0 1 * * *',
          enabled: true,
          accountId: 'account-a',
          params: { interval: 500, names: ['A', 'B'] },
        },
      },
    }])).not.toThrow();
  });

  it('拒绝 enabled 类型错误的任务配置', () => {
    expect(() => assertValidIpcInvokeArgs('task-config:set', [{
      order: ['task-a'],
      configs: { 'task-a': { cron: '0 1 * * *', enabled: 'yes' } },
    }])).toThrow('参数格式无效');
  });

  it('校验账号登录参数', () => {
    expect(() => assertValidIpcInvokeArgs('accounts:add', [{ username: 'Bot', password: 'secret' }])).not.toThrow();
    expect(() => assertValidIpcInvokeArgs('accounts:add', [{ username: 'Bot' }])).toThrow('参数格式无效');
  });
});
