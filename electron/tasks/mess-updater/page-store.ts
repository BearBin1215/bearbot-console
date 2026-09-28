import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';

/** 页面存储记录（对应 pages 表的一行） */
export interface PageRecord {
  /** 页面标题 */
  title: string;
  /** 页面 ID */
  pageid: number;
  /** 命名空间编号 */
  ns: number;
  /** 最新修订版本 ID（用于检测内容变更） */
  revid: number;
  /** 页面源代码（已去除 HTML 注释） */
  text: string;
  /** 所属分类标题列表，如 `Category:10月29日` */
  categories: string[];
}

let db: DatabaseSync | null = null;

/** 获取数据库实例。惰性初始化，首次调用时创建表 */
function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(path.join(app.getPath('userData'), 'mess-updater.db'));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        title TEXT PRIMARY KEY,
        pageid INTEGER NOT NULL,
        ns INTEGER NOT NULL,
        revid INTEGER NOT NULL,
        text TEXT NOT NULL,
        categories TEXT NOT NULL DEFAULT '[]'
      );
    `);
  }
  return db;
}

/**
 * 批量插入或更新页面。使用事务批量写入，避免逐条插入的性能开销。
 * @param pages 页面记录列表
 */
export function upsertPages(pages: PageRecord[]): void {
  if (pages.length === 0) {
    return;
  }
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO pages (title, pageid, ns, revid, text, categories) VALUES (@title, @pageid, @ns, @revid, @text, @categories)
    ON CONFLICT(title) DO UPDATE SET pageid = @pageid, ns = @ns, revid = @revid, text = @text, categories = @categories
  `);
  database.exec('BEGIN');
  try {
    for (const row of pages) {
      stmt.run({
        title: row.title,
        pageid: row.pageid,
        ns: row.ns,
        revid: row.revid,
        text: row.text,
        categories: JSON.stringify(row.categories),
      });
    }
    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
}

/** 仅含元数据的页面记录（受限页面专用，不含正文与分类） */
export interface PageMetaRecord {
  /** 页面标题 */
  title: string;
  /** 页面 ID */
  pageid: number;
  /** 命名空间编号 */
  ns: number;
  /** 最新修订版本 ID */
  revid: number;
}

/**
 * 批量写入页面元数据（受限页面专用）
 *
 * 页面已存在时仅更新 pageid/ns/revid，保留原正文与分类；不存在时插入空正文记录。
 * 用于受限页面：记录最新 revid 使后续增量比对视为无变化，避免每次运行重复请求失败。
 *
 * @param records 页面元数据列表
 */
export function upsertPageMetas(records: PageMetaRecord[]): void {
  if (records.length === 0) {
    return;
  }
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO pages (title, pageid, ns, revid, text, categories) VALUES (@title, @pageid, @ns, @revid, '', '[]')
    ON CONFLICT(title) DO UPDATE SET pageid = @pageid, ns = @ns, revid = @revid
  `);
  database.exec('BEGIN');
  try {
    for (const row of records) {
      stmt.run({
        title: row.title,
        pageid: row.pageid,
        ns: row.ns,
        revid: row.revid,
      });
    }
    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
}

/**
 * 批量删除页面（按标题）
 *
 * 使用事务分批执行，避免占位符数量超限。
 *
 * @param titles 要删除的页面标题列表
 * @returns 实际删除的行数
 */
export function deletePages(titles: string[]): number {
  if (titles.length === 0) {
    return 0;
  }
  const database = getDb();
  /** 单批标题数量上限，避免 SQL 占位符超限 */
  const BATCH = 500;
  let total = 0;
  database.exec('BEGIN');
  try {
    for (let i = 0; i < titles.length; i += BATCH) {
      const batch = titles.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const info = database.prepare(`DELETE FROM pages WHERE title IN (${placeholders})`).run(...batch);
      total += Number(info.changes);
    }
    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
  return total;
}

/**
 * 流式迭代所有页面记录
 *
 * 按 rowid 分页惰性产出，避免一次性把全表源代码载入内存。
 * 检查循环逐条消费、用完即丢；每批之间让出事件循环，避免长时间阻塞主进程。
 *
 * @param chunkSize 单批读取的页面数
 * @yields 逐条页面记录
 */
export async function* iteratePages(chunkSize = 2000): AsyncGenerator<PageRecord> {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT rowid, title, pageid, ns, revid, text, categories FROM pages WHERE rowid > ? ORDER BY rowid LIMIT ?',
  );
  let lastRowid = 0;
  while (true) {
    const rows = stmt.all(lastRowid, chunkSize) as Array<{
      rowid: number;
      title: string;
      pageid: number;
      ns: number;
      revid: number;
      text: string;
      categories: string;
    }>;
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      yield {
        title: row.title,
        pageid: row.pageid,
        ns: row.ns,
        revid: row.revid,
        text: row.text,
        categories: JSON.parse(row.categories) as string[],
      };
    }
    lastRowid = rows[rows.length - 1].rowid;
    // 让出事件循环，使主进程能在批次之间响应 IPC、任务取消等
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * 获取页面总数
 *
 * @returns pages 表中的记录数
 */
export function getPageCount(): number {
  const database = getDb();
  const row = database.prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number };
  return row.count;
}

/**
 * 获取所有页面的标题与修订版本 ID 映射
 *
 * 供增量比对 API revid 清单与本地 DB，不载入页面正文。
 *
 * @returns 标题到 revid 的映射
 */
export function getPageRevids(): Map<string, number> {
  const database = getDb();
  const rows = database.prepare('SELECT title, revid FROM pages').all() as Array<{ title: string; revid: number }>;
  return new Map(rows.map((row) => [row.title, row.revid]));
}
