import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

/**
 * 通用的拖拽排序处理函数
 *
 * 元素本身即为唯一标识时（T 为 string）可省略 getId；其他类型须显式传入 getId 提取标识。
 *
 * @param arr      当前数组
 * @param event    拖拽结束事件
 * @param getId    从数组元素提取唯一标识的函数（T 为 string 时可选，默认取元素本身）
 * @returns        排序后的新数组，若无需排序则返回 null
 */
export function reorderById<T extends string>(
  arr: T[],
  event: DragEndEvent,
  getId?: (item: T) => string,
): T[] | null;

export function reorderById<T>(
  arr: T[],
  event: DragEndEvent,
  getId: (item: T) => string,
): T[] | null;

export function reorderById<T>(
  arr: T[],
  event: DragEndEvent,
  getId: (item: T) => string = (item) => String(item),
): T[] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) {
    return null;
  }

  const oldIndex = arr.findIndex((item) => getId(item) === active.id);
  const newIndex = arr.findIndex((item) => getId(item) === over.id);
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  return arrayMove(arr, oldIndex, newIndex);
}
