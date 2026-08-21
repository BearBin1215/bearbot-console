import { describe, it, expect } from 'vitest';
import type { TaskParamField, TaskParamValues } from '@shared/types';
import { getMissingRequiredParams } from '../../src/lib/task';

// 测试 getMissingRequiredParams 函数（检查必填参数是否缺失，用于 UI 表单提交前校验）
describe('getMissingRequiredParams', () => {
  // #region 边界情况

  it('fields 为 undefined → 返回空数组', () => {
    expect(getMissingRequiredParams(undefined, undefined)).toEqual([]);
  });

  it('values 为 undefined 且必填字段无默认值 → 返回缺失标签', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: true },
    ];
    expect(getMissingRequiredParams(fields, undefined)).toEqual(['名称']);
  });

  it('values 为 undefined 但必填字段有默认值 → 返回空数组', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: true, default: '默认值' },
    ];
    expect(getMissingRequiredParams(fields, undefined)).toEqual([]);
  });

  // #endregion

  // #region 非必填字段

  it('非必填字段无值 → 不在缺失列表中', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: false },
    ];
    expect(getMissingRequiredParams(fields, undefined)).toEqual([]);
  });

  // #endregion

  // #region string 类型必填

  it('string 类型必填有值 → 不缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: true },
    ];
    const values: TaskParamValues = { name: '值' };
    expect(getMissingRequiredParams(fields, values)).toEqual([]);
  });

  it('string 类型必填值为空字符串 → 缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: true },
    ];
    const values: TaskParamValues = { name: '' };
    expect(getMissingRequiredParams(fields, values)).toEqual(['名称']);
  });

  it('string 类型必填值为 null → 缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: true },
    ];
    // 运行时值可能为 null（虽类型不允许，需防御）
    const values = { name: null as unknown as string };
    expect(getMissingRequiredParams(fields, values)).toEqual(['名称']);
  });

  // #endregion

  // #region multi-string 类型

  it('multi-string 类型必填空数组 → 缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'tags', label: '标签', type: 'multi-string', required: true },
    ];
    const values: TaskParamValues = { tags: [] };
    expect(getMissingRequiredParams(fields, values)).toEqual(['标签']);
  });

  it('multi-string 类型必填非空数组 → 不缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'tags', label: '标签', type: 'multi-string', required: true },
    ];
    const values: TaskParamValues = { tags: ['a'] };
    expect(getMissingRequiredParams(fields, values)).toEqual([]);
  });

  it('multi-string 类型必填无值但有默认值 → 不缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'tags', label: '标签', type: 'multi-string', required: true, default: ['默认'] },
    ];
    const values: TaskParamValues = {};
    expect(getMissingRequiredParams(fields, values)).toEqual([]);
  });

  // #endregion

  // #region select 类型

  it('select 单选必填有值 -> 不缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'mode', label: '模式', type: 'select', required: true, options: [] },
    ];
    const values: TaskParamValues = { mode: 'option1' };
    expect(getMissingRequiredParams(fields, values)).toEqual([]);
  });

  it('multi-select 必填非空数组 -> 不缺失', () => {
    const fields: TaskParamField[] = [
      { key: 'modes', label: '模式', type: 'multi-select', required: true, options: [] },
    ];
    const values: TaskParamValues = { modes: ['a'] };
    expect(getMissingRequiredParams(fields, values)).toEqual([]);
  });

  // #endregion

  // #region 多字段组合

  it('多个字段部分缺失 → 仅返回缺失的标签', () => {
    const fields: TaskParamField[] = [
      { key: 'name', label: '名称', type: 'string', required: true },
      { key: 'tags', label: '标签', type: 'multi-string', required: true },
      { key: 'optional', label: '可选', type: 'string', required: false },
    ];
    const values: TaskParamValues = { name: '值' }; // tags 缺失
    expect(getMissingRequiredParams(fields, values)).toEqual(['标签']);
  });

  // #endregion
});
