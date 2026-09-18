/**
 * MassEdit 使用量统计的进度持久化
 *
 * 回溯阶段需要遍历全部有编辑的用户，耗时较长且可能因网络中断失败，本模块记录两类进度：
 *
 * - `coveredUntil`：站点已统计覆盖区间的右端（不含），下次运行以它作为扫描窗口的下界；
 *   它同时决定增量能否走轻量的「最近更改」数据源（超出保留期则回落到「用户贡献」补缺口）。
 * - `windowUntil` 与枚举断点：进行中窗口的上界，以及按用户枚举回溯时的续跑位置。
 *   批次是最小落盘单位，命中结果在整批扫完后才并入累计值，
 *   因此中断只会让当前批重扫一次，不会重复计数。
 *
 * 进度文件为 `{userData}/mass-edit-usage-progress.json`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * 进度文件结构版本
 *
 * 结构变更时递增：旧版本文件里字段的含义与新版本不同，若继续消费会导致重复计数或漏统计
 * （例如把「没有进行中的窗口」误认为「窗口已完成」），因此 {@link loadProgress} 直接判定为无效。
 */
const PROGRESS_VERSION = 1;

/** 单个站点的进度与累计结果 */
export interface SiteProgress {
  /**
   * 已统计覆盖区间的右端（不含），即下次扫描窗口的下界；null 表示尚未统计过，需要完整回溯
   *
   * 按站点独立保存：两个站点串行扫描，若共用一个全局覆盖点，
   * 先完成的站点会因为后完成的站点失败而无法推进，下次运行重扫同一区间导致计数翻倍。
   */
  coveredUntil: string | null;
  /**
   * 进行中窗口的上界；null 表示当前没有未完成的窗口
   *
   * 窗口未完成时下次运行沿用该上界，而不是改用当前时间：已并入累计值的批次其游标已经越过，
   * 扩大窗口会让那些用户在补扫区间内的编辑永久遗漏。
   * 窗口结束时置回 null 并推进 {@link coveredUntil}，两者在同一次落盘中写入。
   */
  windowUntil: string | null;
  /** 用户枚举是否已到末尾（`allusers` 不再返回 `continue`） */
  enumDone: boolean;
  /** 用户枚举游标（`allusers` 的 `aufrom`）；枚举结束后为 null */
  userCursor: string | null;
  /** 当前待扫描批次的用户名列表；为空表示需要取下一批 */
  batch: string[];
  /** 该站点累计的用户名 -> MassEdit 编辑次数 */
  usage: Record<string, number>;
  /** 该站点累计的月份（站点本地时区，`YYYY-MM`）-> MassEdit 编辑次数 */
  monthly: Record<string, number>;
}

/** 统计进度与累计结果 */
export interface MassEditUsageProgress {
  /** 结构版本，见 {@link PROGRESS_VERSION} */
  version: number;
  /** 统计起点（ISO 8601），与本次传参不一致时视为过期进度并从头重扫 */
  since: string;
  /** 站点键 -> 站点进度 */
  sites: Record<string, SiteProgress>;
}

/** 进度文件路径，须在 app ready 后调用 */
function getProgressFile(): string {
  return path.join(app.getPath('userData'), 'mass-edit-usage-progress.json');
}

/** 创建空白站点进度 */
export function createSiteProgress(): SiteProgress {
  return {
    coveredUntil: null,
    windowUntil: null,
    enumDone: false,
    userCursor: null,
    batch: [],
    usage: {},
    monthly: {},
  };
}

/**
 * 创建空白进度
 * @param since 本次运行的统计起点（ISO 8601）
 */
export function createProgress(since: string): MassEditUsageProgress {
  return { version: PROGRESS_VERSION, since, sites: {} };
}

/**
 * 读取进度
 *
 * @returns 进度数据；文件不存在、解析失败或结构版本不符时返回 null，调用方据此从头统计
 */
export function loadProgress(): MassEditUsageProgress | null {
  try {
    const data = JSON.parse(fs.readFileSync(getProgressFile(), 'utf8')) as MassEditUsageProgress;
    const usable = data?.version === PROGRESS_VERSION
      && typeof data.since === 'string'
      && typeof data.sites === 'object' && data.sites !== null;
    return usable ? data : null;
  } catch {
    return null;
  }
}

/**
 * 写入进度（全量覆盖）
 *
 * 每完成一批用户（或一次增量）后调用一次，体积主要为当前批次的用户名列表与已命中的用户计数，
 * 均在可忽略的量级。
 *
 * @param progress 当前进度与累计结果
 */
export function saveProgress(progress: MassEditUsageProgress): void {
  fs.writeFileSync(getProgressFile(), JSON.stringify(progress));
}

/** 删除进度文件（放弃累计结果、从统计起点重新统计时调用） */
export function clearProgress(): void {
  try {
    fs.unlinkSync(getProgressFile());
  } catch {
    // 文件不存在时无需处理
  }
}

/**
 * 取时间戳所在整秒的下一秒
 * @param timestamp ISO 8601 时间戳
 * @returns 秒数为整的 ISO 8601 时间戳
 */
function toNextWholeSecond(timestamp: string): string {
  return new Date(Math.floor(Date.parse(timestamp) / 1000) * 1000 + 1000).toISOString();
}

/**
 * 取得当前窗口的上界，必要时开启新窗口
 *
 * 已有进行中的窗口时返回其原上界，让补扫仍然落在同一区间内。
 *
 * @param stage 站点进度（原地修改）
 * @param windowUntil 需要开启新窗口时使用的上界（ISO 8601）
 * @returns 本次扫描实际使用的窗口上界
 */
export function openWindow(stage: SiteProgress, windowUntil: string): string {
  if (stage.windowUntil !== null) {
    return stage.windowUntil;
  }
  stage.windowUntil = windowUntil;
  stage.enumDone = false;
  stage.userCursor = null;
  stage.batch = [];
  return windowUntil;
}

/**
 * 结束当前窗口：推进覆盖点并清空窗口标记
 *
 * 覆盖点取窗口上界所在整秒的下一秒：API 的时间戳比较按秒截断且下界为闭区间，
 * 直接用窗口上界会让边界那一秒的编辑被相邻两次运行重复统计。
 *
 * @param stage 站点进度（原地修改）
 */
export function closeWindow(stage: SiteProgress): void {
  if (stage.windowUntil === null) {
    return;
  }
  stage.coveredUntil = toNextWholeSecond(stage.windowUntil);
  stage.windowUntil = null;
  stage.enumDone = false;
  stage.userCursor = null;
  stage.batch = [];
}
