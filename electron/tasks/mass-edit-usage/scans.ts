/**
 * MassEdit 使用量统计的扫描策略
 *
 * 两种策略由调用方依据覆盖点与最近更改保留期的关系选择，扫描结果都累加进传入的站点进度：
 *
 * - **回溯**（{@link scanByUserContribs}）：用 `list=allusers&auwitheditsonly=1` 枚举有编辑的用户，
 *   再分批用 `list=usercontribs` 查询各自贡献。读的是未被清理的修订表，不受最近更改保留期限制，
 *   可以覆盖任意久远的历史。
 * - **增量**（{@link scanByRecentChanges}）：用 `list=recentchanges` 按时间拉取窗口内的新增编辑，
 *   几十次请求即可完成，不必重新枚举用户。
 *
 * 请求参数上有两点不能随意改动：
 * `ucuser` 必须给出具体用户名——改用空 `ucuserprefix` 枚举全部用户时，MediaWiki 会把整个 actor 表
 * （百万量级，含历史 IP）放进候选集再与 revision 匹配，实测响应极慢且频繁 502；
 * 给出具体用户名后的条件是 `rev_actor IN (少量 id)`，可以走索引。
 * `ucprop` 只取 `timestamp` 与 `comment`——加上 `tags` 会为每一行附加相关子查询，
 * 而标签只用于过滤，对结果没有影响。
 */
import type { MoegirlApi } from '../../services/moegirl';
import type { TaskLogger } from '../../services/tasks/types';
import { closeWindow } from './progress';
import type { SiteProgress } from './progress';
import { toMonthKey } from './time';

/**
 * 回溯模式下进度日志的最小输出间隔（毫秒）
 *
 * 按时间而非批数控制：每批的耗时随其中用户的历史编辑量波动很大（数秒到数十秒），
 * 固定批数会让日志节奏难以预期。
 */
const LOG_INTERVAL_MS = 5 * 60 * 1000;

/** `list=allusers` 返回的用户（仅声明本任务使用的字段） */
interface AllUsersEntry {
  /** 用户名 */
  name: string;
}

/** `list=usercontribs` 与 `list=recentchanges` 返回记录中本任务使用的字段 */
interface EditRecord {
  /** 编辑者用户名，匿名编辑为 IP */
  user: string;
  /** 编辑摘要；被修订删除时为 `commenthidden` */
  comment?: string;
  /** 编辑时间（ISO 8601，UTC） */
  timestamp?: string;
}

/**
 * 把一批计数并入累计值
 * @param target 累计映射（原地修改）
 * @param source 待并入的映射
 */
function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

/**
 * 判断一条记录是否由 MassEdit 产生，是则计入累计值
 *
 * 两种策略拿到的记录结构一致，命中判定与累计口径也必须一致，因此共用此处。
 *
 * @param record 贡献或最近更改记录
 * @param usage 用户名 -> 次数的累计映射（原地修改）
 * @param monthly 月份 -> 次数的累计映射（原地修改）
 * @returns 是否命中
 */
function countIfMassEdit(
  record: EditRecord,
  usage: Record<string, number>,
  monthly: Record<string, number>,
): boolean {
  if (!record.comment?.includes('MassEdit')) {
    return false;
  }
  usage[record.user] = (usage[record.user] ?? 0) + 1;
  const month = toMonthKey(record.timestamp);
  if (month) {
    monthly[month] = (monthly[month] ?? 0) + 1;
  }
  return true;
}

/**
 * 依次取得下一批待扫描的用户名
 *
 * 批的大小与 `ucuser` 的多值上限一致，因此每批可直接作为一次 `usercontribs` 查询的入参。
 *
 * @param api 站点 API 客户端
 * @param progress 站点进度，原地写入批次与枚举游标
 * @param batchSize 单批用户数
 * @returns 是否成功取到非空批次（false 表示用户已枚举完）
 */
async function takeNextBatch(
  api: MoegirlApi,
  progress: SiteProgress,
  batchSize: number,
): Promise<boolean> {
  if (progress.enumDone) {
    return false;
  }
  const response = await api.post({
    action: 'query',
    list: 'allusers',
    // 只枚举至少有过一次编辑的用户，跳过大量从未编辑的注册账号
    auwitheditsonly: 1,
    aulimit: batchSize,
    aufrom: progress.userCursor ?? false,
  });
  progress.batch = ((response.query?.allusers ?? []) as AllUsersEntry[]).map((item) => item.name);
  progress.userCursor = response.continue?.aufrom ?? null;
  progress.enumDone = !response.continue;
  return progress.batch.length > 0;
}

/**
 * 回溯模式：枚举有编辑的用户，并分批统计其贡献中含 MassEdit 的编辑
 *
 * 批内翻页只用局部变量累计，整批扫完后才并入 {@link SiteProgress.usage}，
 * 因此中断导致当前批重扫不会重复计数。用户枚举完时结束窗口并推进覆盖点。
 * 调用方须先用 `openWindow` 开启窗口，窗口上界即 `until`。
 *
 * @param api 该站点的 API 客户端
 * @param label 站点显示名（用于日志）
 * @param from 时间窗口下界（ISO 8601）
 * @param until 时间窗口上界（ISO 8601）
 * @param batchSize 单批用户数
 * @param progress 该站点的进度对象，原地累计与推进游标
 * @param persist 进度变更后的落盘回调
 * @param logger 任务日志接口
 * @param signal 任务取消信号
 */
export async function scanByUserContribs(
  api: MoegirlApi,
  label: string,
  from: string,
  until: string,
  batchSize: number,
  progress: SiteProgress,
  persist: () => void,
  logger: TaskLogger,
  signal: AbortSignal,
): Promise<void> {
  /** 本次运行累计扫描的修订总数 */
  let scanned = 0;
  /** 本次运行累计命中的 MassEdit 编辑数 */
  let matched = 0;
  /** 上次输出进度日志的时刻，用于控制日志节奏（0 表示尚未输出过，首批完成即输出） */
  let lastLogAt = 0;

  // 枚举到末尾时结束窗口并退出循环
  while (progress.windowUntil !== null) {
    signal.throwIfAborted();

    if (progress.batch.length === 0) {
      const hasBatch = await takeNextBatch(api, progress, batchSize);
      if (!hasBatch) {
        closeWindow(progress);
        persist();
        break;
      }
      persist();
    }

    /** 当前批次的局部累计，整批扫完后才并入总结果 */
    const batchUsage: Record<string, number> = {};
    const batchMonthly: Record<string, number> = {};
    let cursor: string | null = null;

    do {
      signal.throwIfAborted();
      const response = await api.post({
        action: 'query',
        list: 'usercontribs',
        ucuser: progress.batch,
        ucdir: 'older',
        ucstart: until,
        ucend: from,
        // 交给服务端取上限：普通账号 500，具备 apihighlimits 时为 5000
        uclimit: 'max',
        ucprop: ['timestamp', 'comment'],
        uccontinue: cursor ?? false,
      });
      for (const record of (response.query?.usercontribs ?? []) as EditRecord[]) {
        scanned += 1;
        if (countIfMassEdit(record, batchUsage, batchMonthly)) {
          matched += 1;
        }
      }
      cursor = response.continue?.uccontinue ?? null;
    } while (cursor);

    mergeCounts(progress.usage, batchUsage);
    mergeCounts(progress.monthly, batchMonthly);
    progress.batch = [];
    persist();

    // 按固定时间间隔输出进度，避免长任务刷屏；命中数在日志中累计体现
    if (Date.now() - lastLogAt >= LOG_INTERVAL_MS) {
      lastLogAt = Date.now();
      logger.info(
        `【${label}】已扫描${scanned}条修订，命中${matched}次，累计${Object.keys(progress.usage).length}名使用者`,
      );
    }
  }

  logger.info(`【${label}】回溯完成：共扫描${scanned}条修订，命中${matched}次`);
}

/**
 * 增量模式：用最近更改拉取时间窗口内的新增编辑
 *
 * 结果先累计到局部变量，整个站点扫完后才并入累计值。增量数据量小（几十次请求），
 * 中断后按同一窗口重扫即可，因此无需持久化分页游标也不会重复计数。
 *
 * @param api 该站点的 API 客户端
 * @param label 站点显示名（用于日志）
 * @param from 时间窗口下界（ISO 8601）
 * @param until 时间窗口上界（ISO 8601）
 * @param progress 该站点的进度对象，原地累加
 * @param persist 进度变更后的落盘回调
 * @param logger 任务日志接口
 * @param signal 任务取消信号
 */
export async function scanByRecentChanges(
  api: MoegirlApi,
  label: string,
  from: string,
  until: string,
  progress: SiteProgress,
  persist: () => void,
  logger: TaskLogger,
  signal: AbortSignal,
): Promise<void> {
  const beginAt = Date.now();
  /** 本次增量的局部累计，全部扫完后才并入总结果 */
  const changes: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  let scanned = 0;
  let matched = 0;
  let rccontinue: string | null = null;

  do {
    signal.throwIfAborted();
    const response = await api.post({
      action: 'query',
      list: 'recentchanges',
      // 只统计数据型变更，排除日志类记录
      rctype: ['edit', 'new'],
      rcprop: ['user', 'timestamp', 'comment'],
      rcdir: 'newer',
      rcstart: from,
      rcend: until,
      rclimit: 'max',
      rccontinue: rccontinue ?? false,
    });
    for (const record of (response.query?.recentchanges ?? []) as EditRecord[]) {
      scanned += 1;
      if (countIfMassEdit(record, changes, monthly)) {
        matched += 1;
      }
    }
    rccontinue = response.continue?.rccontinue ?? null;
  } while (rccontinue);

  mergeCounts(progress.usage, changes);
  mergeCounts(progress.monthly, monthly);
  // 累计值与窗口结束在同一次落盘中写入，中断后不会重复统计该窗口
  closeWindow(progress);
  persist();

  const seconds = Math.round((Date.now() - beginAt) / 1000);
  logger.info(`【${label}】增量读取完成：扫描${scanned}条最近更改，命中${matched}次（耗时${seconds}秒）`);
}
