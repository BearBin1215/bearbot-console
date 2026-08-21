import { describe, it, expect } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { reorderById } from '../../src/lib/dnd-utils';

/** 构造模拟的 DragEndEvent，仅填充 reorderById 用到的 active.id 和 over.id 字段 */
function makeEvent(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
}

// 测试 reorderById 函数（拖拽排序，返回新数组或 null 表示无需排序）
describe('reorderById', () => {
  // #region 字符串数组（省略 getId）

  it('向后移动元素 → 返回新顺序', () => {
    const arr = ['a', 'b', 'c', 'd'];
    expect(reorderById(arr, makeEvent('a', 'c'))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('向前移动元素 → 返回新顺序', () => {
    const arr = ['a', 'b', 'c', 'd'];
    expect(reorderById(arr, makeEvent('d', 'b'))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('相邻元素交换', () => {
    const arr = ['a', 'b', 'c'];
    expect(reorderById(arr, makeEvent('a', 'b'))).toEqual(['b', 'a', 'c']);
  });

  // #endregion


  // #region 无需排序的情况

  it('active.id === over.id → 返回 null', () => {
    const arr = ['a', 'b', 'c'];
    expect(reorderById(arr, makeEvent('a', 'a'))).toBeNull();
  });

  it('over 为 null → 返回 null', () => {
    const arr = ['a', 'b', 'c'];
    expect(reorderById(arr, makeEvent('a', null))).toBeNull();
  });

  // #endregion


  // #region 元素未找到

  it('active.id 不在数组中 → 返回 null', () => {
    const arr = ['a', 'b', 'c'];
    expect(reorderById(arr, makeEvent('x', 'b'))).toBeNull();
  });

  it('over.id 不在数组中 → 返回 null', () => {
    const arr = ['a', 'b', 'c'];
    expect(reorderById(arr, makeEvent('a', 'x'))).toBeNull();
  });

  // #endregion


  // #region 不修改原数组

  it('不修改原数组（返回新引用）', () => {
    const arr = ['a', 'b', 'c'];
    const result = reorderById(arr, makeEvent('a', 'c'));
    expect(arr).toEqual(['a', 'b', 'c']);
    expect(result).toEqual(['b', 'c', 'a']);
    expect(result).not.toBe(arr);
  });

  // #endregion

  // #region 对象数组（需传入 getId）

  it('对象数组通过 getId 提取标识 → 正确排序', () => {
    const arr = [
      { id: '1', name: '甲' },
      { id: '2', name: '乙' },
      { id: '3', name: '丙' },
    ];
    const result = reorderById(arr, makeEvent('1', '3'), (item) => item.id);
    expect(result).toEqual([
      { id: '2', name: '乙' },
      { id: '3', name: '丙' },
      { id: '1', name: '甲' },
    ]);
  });

  // #endregion

  // #region 边界情况

  it('空数组 → 返回 null（未找到元素）', () => {
    const arr: string[] = [];
    expect(reorderById(arr, makeEvent('a', 'b'))).toBeNull();
  });

  // #endregion
});
