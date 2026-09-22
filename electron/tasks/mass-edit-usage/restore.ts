/**
 * MassEdit 使用量统计的进度恢复
 *
 * 进度文件位于 `{userData}`，换机、重装或清理缓存后会丢失。结果页面本身保存着一份一致快照：
 * `lastUpdate` 是数据覆盖到的上界，`usage` / `monthly` 是该时点的全量累计。据此恢复即可接续增量统计，
 * 不必从 MassEdit 启用时间起重扫全站用户。
 *
 * 恢复口径必须与 `SiteProgress` 一致：只有页面中该站点的 `usage` 与 `monthly` 都是合法的计数映射才恢复该站点，
 * 否则让它保持未覆盖、下次从头扫描；任一站点缺失都不影响其他站点。
 */
import type { MoegirlApi } from '../../services/moegirl';
import type { TaskLogger } from '../../services/tasks/types';
import { createProgress, createSiteProgress, toNextWholeSecond } from './progress';
import type { MassEditUsageProgress } from './progress';
import { formatSiteTime } from './time';

/** 结果页面 JSON 中本模块读取的字段（逐项校验，故按 unknown 处理） */
interface PageSnapshot {
  /** 数据覆盖到的上界（ISO 8601） */
  lastUpdate?: unknown;
  /** 站点键 -> 用户名 -> 次数 */
  usage?: unknown;
  /** 站点键 -> 月份 -> 次数 */
  monthly?: unknown;
}

/**
 * 校验并复制「键 -> 次数」映射
 *
 * 页面可能被人工编辑，一旦混入非有限数值就会污染后续累加，因此整项判为不可用。
 *
 * @param value 页面中的字段值
 * @returns 新的计数映射；不是纯对象或存在非有限数值时返回 null
 */
function parseCounts(value: unknown): Record<string, number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      return null;
    }
    counts[key] = count;
  }
  return counts;
}

/**
 * 从结果页面恢复统计进度
 *
 * @param api 主站 API 客户端（结果页面位于主站）
 * @param title 结果页面标题
 * @param since 本次运行的统计起点（ISO 8601），写入恢复出的进度
 * @param sites 参与统计的站点键与显示名
 * @param logger 任务日志接口
 * @returns 恢复出的进度；页面不可读、快照不完整或时间戳不可信时返回 null，调用方据此从头统计
 */
export async function restoreProgress(
  api: MoegirlApi,
  title: string,
  since: string,
  sites: readonly { key: string; label: string }[],
  logger: TaskLogger,
): Promise<MassEditUsageProgress | null> {
  let snapshot: PageSnapshot;
  try {
    snapshot = JSON.parse(await api.getPageSource(title)) as PageSnapshot;
  } catch (error) {
    logger.warn(`未能从[[${title}]]恢复进度：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  // 覆盖上界须落在 (since, now] 内：早于统计起点说明快照比本次范围还旧，晚于当前时间说明时间戳不可信，
  // 两种情况下用其作为下界都会漏统计，宁可重扫
  const lastUpdate = typeof snapshot.lastUpdate === 'string' ? snapshot.lastUpdate : null;
  const lastUpdateMs = lastUpdate ? Date.parse(lastUpdate) : NaN;
  if (!lastUpdate
    || !Number.isFinite(lastUpdateMs)
    || lastUpdateMs <= Date.parse(since)
    || lastUpdateMs > Date.now()) {
    logger.warn(`[[${title}]]中的 lastUpdate 不可用，改为从头统计`);
    return null;
  }
  const coveredUntil = toNextWholeSecond(lastUpdate);

  const progress = createProgress(since);
  /** 成功恢复的站点描述，用于日志 */
  const restored: string[] = [];
  for (const site of sites) {
    const usage = parseCounts((snapshot.usage as Record<string, unknown> | undefined)?.[site.key]);
    const monthly = parseCounts((snapshot.monthly as Record<string, unknown> | undefined)?.[site.key]);
    if (!usage || !monthly) {
      continue;
    }
    progress.sites[site.key] = {
      ...createSiteProgress(),
      coveredUntil,
      usage,
      monthly,
    };
    restored.push(`${site.label}（${Object.keys(usage).length}名使用者）`);
  }

  if (restored.length === 0) {
    logger.warn(`[[${title}]]中没有可用的站点数据，改为从头统计`);
    return null;
  }
  logger.info(
    `本地进度缺失，已从[[${title}]]接续统计：${restored.join('、')}，覆盖至${formatSiteTime(coveredUntil)}`,
  );
  return progress;
}
