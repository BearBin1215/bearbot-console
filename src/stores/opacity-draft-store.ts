import { create } from 'zustand';

/**
 * 背景透明度拖拽草稿（内存态，不持久化）
 *
 * 拖拽滑块时实时写入此 store，供 Layout 预览遮罩透明度；松手时由 Settings
 * 提交到持久化的 settingsStore 并清空草稿。这样可以避免拖拽过程中触发高频
 * IPC 落盘，又保留实时预览。
 *
 * `draft` 为 null 表示当前未在拖拽，调用方应回退到持久化值。
 */
interface OpacityDraftState {
  draft: number | null;
  setDraft: (v: number | null) => void;
}

export const useOpacityDraftStore = create<OpacityDraftState>((set) => ({
  draft: null,
  setDraft: (v) => set({ draft: v }),
}));
