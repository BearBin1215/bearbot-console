/**
 * 站点本地时间换算
 *
 * 萌百的 `timeoffset` 为 480，即 UTC+8。月度统计按站点本地月份归组、日志按本地时间展示才符合直觉，
 * 而 API 返回的时间戳一律为 UTC，因此统一在本模块做一次偏移。
 */
const SITE_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 两位数补零 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 把 UTC 时间戳换算为站点本地时间
 *
 * 返回值是「钟面与站点本地一致」的 Date，读取时须用 `getUTC*` 系列，避免受运行环境时区影响。
 *
 * @param timestamp ISO 8601 时间戳（UTC）
 * @returns 换算结果；无法解析时返回 null
 */
function toSiteLocal(timestamp: string): Date | null {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : new Date(parsed + SITE_TIMEZONE_OFFSET_MS);
}

/**
 * 把 UTC 时间戳换算成站点本地月份键
 * @param timestamp ISO 8601 时间戳（UTC）
 * @returns `YYYY-MM` 形式的月份键；缺失或无法解析时返回 null
 */
export function toMonthKey(timestamp: string | undefined): string | null {
  const local = timestamp ? toSiteLocal(timestamp) : null;
  if (!local) {
    return null;
  }
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}`;
}

/**
 * 把 UTC 时间戳格式化为站点本地时区的可读时间
 * @param timestamp ISO 8601 时间戳（UTC）
 * @returns `YYYY-MM-DD HH:mm:ss` 形式的字符串；无法解析时原样返回
 */
export function formatSiteTime(timestamp: string): string {
  const local = toSiteLocal(timestamp);
  if (!local) {
    return timestamp;
  }
  const date = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
  const time = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
  return `${date} ${time}`;
}
