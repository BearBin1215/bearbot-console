/**
 * 日志服务
 *
 * 负责将任务执行日志按天分割写入本地文件（JSONL 格式），存储在 `{userData}/logs/` 目录下。
 * 每条日志为一个 `TaskLogEvent` 对象，按行追加写入当天的 `YYYY-MM-DD.log` 文件。
 *
 * 启动时自动清理超过保留期（{@link RETENTION_DAYS} 天）的旧日志文件。
 * 提供追加写入（{@link appendLog}）和批量加载（{@link loadRecentLogs}）两个核心接口，
 * 前者供主进程任务执行时调用，后者供渲染进程展示日志列表时调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import dayjs from 'dayjs';
import type { TaskLogEvent } from '@shared/types';

/** 日志保留天数（超过自动删除） */
const RETENTION_DAYS = 30;

/** 获取日志目录路径，须在 app ready 后调用 */
function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

/** 获取指定日期的日志文件路径 */
function getLogFilePath(date: Date): string {
  return path.join(getLogDir(), `${dayjs(date).format('YYYY-MM-DD')}.log`);
}

/** 清理超过保留期的日志文件（按文件名日期判断） */
function cleanExpiredLogs(): void {
  const cutoff = dayjs().subtract(RETENTION_DAYS, 'day').valueOf();
  let files: string[];
  try {
    files = fs.readdirSync(getLogDir());
  } catch {
    return;
  }
  for (const file of files) {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
    if (!match) {
      continue;
    }
    const fileDate = dayjs(match[1], 'YYYY-MM-DD');
    if (!fileDate.isValid() || fileDate.valueOf() < cutoff) {
      try {
        fs.unlinkSync(path.join(getLogDir(), file));
      } catch {
        // 删除失败静默忽略，下次启动重试
      }
    }
  }
}

/**
 * 初始化日志系统
 *
 * 创建日志目录并清理超过保留期的日志文件。须在 app ready 后调用。
 */
export function initLogger(): void {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  cleanExpiredLogs();
}

/** 追加一条日志到当天文件（JSONL 格式） */
export function appendLog(entry: TaskLogEvent): void {
  const filePath = getLogFilePath(new Date());
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // 写入失败静默忽略，不影响任务执行
  }
}

/**
 * 加载最近 count 条日志
 * @param count 最多加载的条数（与渲染进程 logStore 上限对齐）
 */
export function loadRecentLogs(count: number): TaskLogEvent[] {
  const result: TaskLogEvent[] = [];
  const today = new Date();
  // 从当天的日志文件往前遍历（最多 RETENTION_DAYS 天），按时间正序返回。
  for (let i = 0; i < RETENTION_DAYS && result.length < count; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    let content: string;
    try {
      content = fs.readFileSync(getLogFilePath(date), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n').filter(Boolean);
    for (let j = lines.length - 1; j >= 0 && result.length < count; j--) {
      try {
        result.push(JSON.parse(lines[j]) as TaskLogEvent);
      } catch {
        // 跳过损坏行
      }
    }
  }
  // result 当前为倒序（最新在前），反转为时间正序
  return result.reverse();
}
