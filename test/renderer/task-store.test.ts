import { describe, it, expect } from 'vitest';
import type { TaskDefinition, TaskConfig } from '@shared/types';
import { buildTaskList } from '../../src/stores/task-store';

// 测试 buildTaskList 函数（合并 definition 与 config 生成 UI 展示用的 TaskInfo 列表）
describe('buildTaskList', () => {
  /** 构造一个最小 TaskDefinition */
  const makeDef = (taskKey: string, defaultName = `默认-${taskKey}`): TaskDefinition => ({
    taskKey,
    defaultName,
    defaultDescription: `描述-${taskKey}`,
  });

  /** 构造一个完整 TaskConfig */
  const makeConfig = (overrides: Partial<TaskConfig> = {}): TaskConfig => ({
    cron: '',
    enabled: false,
    ...overrides,
  });


  // #region 空输入

  it('空 definitions 与空 configs → 返回空列表', () => {
    expect(buildTaskList([], {})).toEqual([]);
  });

  it('无 order 时按 definitions 顺序返回', () => {
    const defs = [makeDef('a'), makeDef('b'), makeDef('c')];
    const result = buildTaskList(defs, {});
    expect(result.map((t) => t.taskKey)).toEqual(['a', 'b', 'c']);
  });

  // #endregion


  // #region order 排序

  it('有 order 时按 order 顺序返回', () => {
    const defs = [makeDef('a'), makeDef('b'), makeDef('c')];
    const result = buildTaskList(defs, {}, ['c', 'a', 'b']);
    expect(result.map((t) => t.taskKey)).toEqual(['c', 'a', 'b']);
  });

  it('order 中存在 def 不存在的 key → 跳过该位置', () => {
    const defs = [makeDef('a'), makeDef('b')];
    const result = buildTaskList(defs, {}, ['ghost', 'a', 'b']);
    expect(result.map((t) => t.taskKey)).toEqual(['a', 'b']);
  });

  it('order 不包含全部 def → 仅返回 order 中存在的 key（追加由 loadConfigs 处理，不属于本函数职责）', () => {
    const defs = [makeDef('a'), makeDef('b'), makeDef('c')];
    const result = buildTaskList(defs, {}, ['a']);
    expect(result.map((t) => t.taskKey)).toEqual(['a']);
  });

  // #endregion


  // #region config 缺失与默认值

  it('config 缺失 → cron 为空字符串、enabled 为 false', () => {
    const defs = [makeDef('a')];
    const result = buildTaskList(defs, {});
    expect(result[0]).toMatchObject({ taskKey: 'a', cron: '', enabled: false });
  });

  it('config 存在 → 透传 cron 与 enabled', () => {
    const defs = [makeDef('a')];
    const configs = { a: makeConfig({ cron: '0 1 * * *', enabled: true }) };
    const result = buildTaskList(defs, configs);
    expect(result[0]).toMatchObject({ taskKey: 'a', cron: '0 1 * * *', enabled: true });
  });

  it('accountId 从 config 透传', () => {
    const defs = [makeDef('a')];
    const configs = { a: makeConfig({ accountId: 'acc-1' }) };
    const result = buildTaskList(defs, configs);
    expect(result[0].accountId).toBe('acc-1');
  });

  it('paramValues 从 config.params 透传', () => {
    const defs = [makeDef('a')];
    const configs = { a: makeConfig({ params: { foo: 'bar', count: 10 } }) };
    const result = buildTaskList(defs, configs);
    expect(result[0].paramValues).toEqual({ foo: 'bar', count: 10 });
  });

  // #endregion


  // #region overrides 优先级

  it('overrides.name 优先于 defaultName', () => {
    const defs = [makeDef('a', '默认名')];
    const configs = { a: makeConfig({ overrides: { name: '自定义名' } }) };
    const result = buildTaskList(defs, configs);
    expect(result[0].name).toBe('自定义名');
    // defaultName 仍保留在字段中
    expect(result[0].defaultName).toBe('默认名');
  });

  it('无 overrides.name 时使用 defaultName', () => {
    const defs = [makeDef('a', '默认名')];
    const result = buildTaskList(defs, {});
    expect(result[0].name).toBe('默认名');
  });

  it('overrides.description 优先于 defaultDescription', () => {
    const defs = [makeDef('a')];
    const configs = { a: makeConfig({ overrides: { description: '自定义描述' } }) };
    const result = buildTaskList(defs, configs);
    expect(result[0].description).toBe('自定义描述');
  });

  it('无 overrides.description 时使用 defaultDescription', () => {
    const defs = [makeDef('a')];
    const result = buildTaskList(defs, {});
    expect(result[0].description).toBe('描述-a');
  });

  // #endregion


  // #region params 字段透传

  it('definition.params 透传到结果的 params 字段', () => {
    const defs: TaskDefinition[] = [{
      taskKey: 'a',
      defaultName: '任务A',
      params: [{ key: 'mode', label: '模式', type: 'select', options: [] }],
    }];
    const result = buildTaskList(defs, {});
    expect(result[0].params).toEqual([{ key: 'mode', label: '模式', type: 'select', options: [] }]);
  });

  // #endregion
});
