/**
 * mess-updater 全量获取断点续传进度持久化
 *
 * 首次全量获取全站页面（约 22 万条）耗时较长且易因网络中断失败，
 * 本模块按命名空间记录已拉取到的 gapcontinue 断点，中断后下次运行从断点继续，
 * 避免每次失败都从头重拉。
 *
 * 进度文件为 `{userData}/mess-updater-progress.json`，结构 `{ [ns]: gapcontinue }`，
 * 某命名空间全量完成后清除对应键，全部完成时删除文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** 进度文件路径，须在 app ready 后调用 */
function getProgressFile(): string {
  return path.join(app.getPath('userData'), 'mess-updater-progress.json');
}

/** 读取全部断点进度（命名空间编号字符串 -> gapcontinue） */
export function loadProgress(): Record<string, string> {
  try {
    const content = fs.readFileSync(getProgressFile(), 'utf8');
    const data = JSON.parse(content);
    return typeof data === 'object' && data !== null ? data as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** 保存指定命名空间的断点 gapcontinue */
export function saveProgress(namespace: number, gapcontinue: string): void {
  const data = loadProgress();
  data[String(namespace)] = gapcontinue;
  fs.writeFileSync(getProgressFile(), JSON.stringify(data));
}

/** 清除指定命名空间的断点（全量完成时调用），无残留键时删除进度文件 */
export function clearProgress(namespace: number): void {
  const data = loadProgress();
  if (!(String(namespace) in data)) {
    return;
  }
  delete data[String(namespace)];
  if (Object.keys(data).length === 0) {
    try {
      fs.unlinkSync(getProgressFile());
    } catch {
      // 删除失败静默忽略，下次完成时重试
    }
  } else {
    fs.writeFileSync(getProgressFile(), JSON.stringify(data));
  }
}
