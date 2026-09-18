/**
 * MassEdit 小工具使用量统计任务
 *
 * 遍历萌娘百科（主站 + 共享站）的编辑者，统计编辑摘要中含 `MassEdit` 字样的编辑，
 * 同时累计「每个使用者各用了多少次」与「每个月总共用了多少次」，
 * 结果以 JSON 写入 User:BearBot/MassEditUsage.json
 */
import type { TaskParamValues } from '@shared/types';
import type { TaskHandler } from '../../services/tasks/types';
import {
  clearProgress,
  createProgress,
  createSiteProgress,
  loadProgress,
  openWindow,
  saveProgress,
} from './progress';
import type { MassEditUsageProgress } from './progress';
import { scanByRecentChanges, scanByUserContribs } from './scans';
import { formatSiteTime } from './time';

/** 统计起点：MassEdit 小工具启用时间，往前推一天避免边界缺失 */
const DEFAULT_SINCE = '2023-04-27T00:00:00Z';

/** 最近更改保留期的默认天数，取85避免边界缺失 */
export const DEFAULT_RC_MAX_AGE_DAYS = 85;

/** 统计结果写入的目标页面 */
const TARGET_PAGE = 'User:BearBot/MassEditUsage.json';

/** 结果页面的编辑摘要 */
const EDIT_SUMMARY = '自动更新列表';

/** 统计结果 JSON 的结构（字段与键名保持结果页面既有格式，另补充月度维度） */
interface MassEditUsageData {
  /** 本次统计完成时间（ISO 8601） */
  lastUpdate: string;
  /** 站点键 -> 用户名 -> MassEdit 编辑次数 */
  usage: Record<string, Record<string, number>>;
  /** 站点键 -> 月份（`YYYY-MM`，站点本地时区）-> MassEdit 编辑次数 */
  monthly: Record<string, Record<string, number>>;
  /** 汇总统计 */
  statistic: {
    /** 去重后的使用者总数（跨站点合并） */
    userCount: number;
    /** MassEdit 编辑总次数（跨站点合并） */
    editCount: number;
  };
}

/**
 * 解析本次运行实际生效的统计起点
 *
 * 默认从 {@link DEFAULT_SINCE}（MassEdit 小工具启用时间）开始，覆盖该工具的全部使用历史；
 * 「仅统计最近天数」大于 0 时改为以当前时间往前推算，用于小范围快速验证。后者随运行时刻变动，
 * 因此每次运行都会重新统计。
 *
 * @param params 任务参数
 * @returns ISO 8601 字符串（UTC）
 */
function resolveSince(params: TaskParamValues): string {
  const recentDays = Number(params.recentDays);
  if (Number.isFinite(recentDays) && recentDays > 0) {
    return new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();
  }
  return DEFAULT_SINCE;
}

/**
 * 解析最近更改保留期天数
 *
 * @param value 任务参数中的天数
 * @returns 正整数天数；非正数或无法解析时回退默认值
 */
function resolveRcMaxAgeDays(value: unknown): number {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_RC_MAX_AGE_DAYS;
}

/**
 * 按比较器重排映射
 *
 * 扫描顺序由用户名或断点续跑决定，输出前统一排序，避免结果页产生无意义的版本差异。
 *
 * @param record 待排序的映射
 * @param compare 键值对比较器
 * @returns 排好序的新对象
 */
function sortRecord(
  record: Record<string, number>,
  compare: (a: [string, number], b: [string, number]) => number,
): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(compare));
}

/**
 * 统计 MassEdit 小工具的使用量并更新结果页面
 *
 * 首次运行会从 {@link DEFAULT_SINCE} 起完整回溯；之后每次运行只需统计上次覆盖点至今的增量。
 * 窗口扫描完成即结束窗口并推进覆盖点（见 ./progress），因此无论页面是否写入成功，下次都不会重复统计同一区间。
 */
const massEditUsage: TaskHandler = async ({ api, commonsApi, logger, params, signal, user }) => {
  const since = resolveSince(params);
  if (Date.parse(since) >= Date.now()) {
    throw new Error(`统计起点（${since}）必须早于当前时间`);
  }
  /** 单批用户数与 `ucuser` 的多值上限一致，随账号是否具备 apihighlimits 变化 */
  const batchSize = (await user.getRights()).includes('apihighlimits') ? 500 : 50;
  const rcMaxAgeDays = resolveRcMaxAgeDays(params.rcMaxAgeDays);
  /** 试运行：仅统计并输出日志，不写入结果页面。未显式配置时保持试运行，避免误写页面 */
  const dryRun = params.dryRun !== 'false';

  // 重置：删除进度文件，下次从统计起点重新累计。若保留旧累计值，会与重扫结果重复计数
  if (params.reset === 'true') {
    clearProgress();
  }
  // 统计起点被改动说明需要在更早的时间范围内重扫，此时同样丢弃旧累计值
  const cached = loadProgress();
  const progress: MassEditUsageProgress = cached?.since === since ? cached : createProgress(since);

  const persist = () => saveProgress(progress);

  /** 参与统计的站点，键名沿用结果页面既有格式的 zh / cm */
  const sites = [
    { key: 'zh', label: '主站', client: api },
    { key: 'cm', label: '共享站', client: commonsApi },
  ] as const;

  for (const site of sites) {
    const stage = (progress.sites[site.key] ??= createSiteProgress());
    /** 该站点的窗口下界：续跑沿用上次窗口的下界，否则从覆盖点或统计起点开始 */
    const windowStart = stage.coveredUntil ?? progress.since;
    /** 该站点的窗口上界；已有未完成的窗口时沿用其原上界，使补扫仍落在同一区间 */
    const windowUntil = openWindow(stage, new Date().toISOString());
    // 覆盖点仍在最近更改保留期内时，增量走更轻量的数据源
    const withinRcRetention = stage.coveredUntil !== null
      && Date.now() - Date.parse(stage.coveredUntil) <= rcMaxAgeDays * 24 * 60 * 60 * 1000;

    logger.info(`【${site.label}】统计起始日期：${formatSiteTime(windowStart)}`);

    if (withinRcRetention) {
      await scanByRecentChanges(site.client, site.label, windowStart, windowUntil, stage, persist, logger, signal);
    } else {
      await scanByUserContribs(
        site.client,
        site.label,
        windowStart,
        windowUntil,
        batchSize,
        stage,
        persist,
        logger,
        signal,
      );
    }
  }

  /** 站点键 -> 用户名 -> 次数（按次数降序，输出稳定） */
  const usage: Record<string, Record<string, number>> = {};
  /** 站点键 -> 月份 -> 次数（按月份升序，输出稳定） */
  const monthly: Record<string, Record<string, number>> = {};
  for (const site of sites) {
    const stage = progress.sites[site.key];
    usage[site.key] = sortRecord(stage.usage, ([, a], [, b]) => b - a);
    monthly[site.key] = sortRecord(stage.monthly, ([a], [b]) => a.localeCompare(b));
  }

  /** 跨站点合并后的去重使用者集合 */
  const users = new Set(Object.values(usage).flatMap((byUser) => Object.keys(byUser)));
  /** 跨站点合并后的编辑总次数 */
  const editCount = Object.values(usage)
    .flatMap((byUser) => Object.values(byUser))
    .reduce((sum, count) => sum + count, 0);

  const data: MassEditUsageData = {
    lastUpdate: new Date().toISOString(),
    usage,
    monthly,
    statistic: { userCount: users.size, editCount },
  };
  logger.info(`统计结果：${users.size}名使用者，共${editCount}次 MassEdit 编辑`);

  if (dryRun) {
    logger.info('当前为试运行模式，未写入结果页面');
    logger.log(JSON.stringify(data, null, '    '));
    return;
  }

  await api.editPage(TARGET_PAGE, JSON.stringify(data, null, '    '), EDIT_SUMMARY);
  logger.info(`已更新[[${TARGET_PAGE}]]`);
};

export default massEditUsage;
