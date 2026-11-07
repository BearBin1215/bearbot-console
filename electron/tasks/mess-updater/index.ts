import type { QueryRequest } from 'types-mediawiki-params';
import type { ApiPageIdentity, ApiQueryResponse, InfoPageExisting, QueryPage } from 'types-mediawiki-response';
import type { TaskContext, TaskHandler } from '../../services/tasks/types';
import type { MoegirlApi, RequestOptions } from '../../services/moegirl';
import { getAllSettings } from '../../services/store';
import { deletePages, getPageCount, getPageRevids, iteratePages, upsertPageMetas, upsertPages, type PageRecord } from './page-store';
import { createMainChecks, createTemplateChecks } from './checks';
import { MESS_DATA, MessOutput } from './output';

/** 需要排除的页顶提示模板名称 */
const EXCLUDED_TOP_TIPS = ['架空历史'];

/** 检查进度日志的输出间隔（条目数） */
const LOG_INTERVAL = 20000;

/** 本任务追踪的命名空间（主空间与模板空间） */
const TRACKED_NAMESPACES = [0, 10];

/** 单条日志中列出的标题数量上限（超出部分仅显示数量） */
const LOG_TITLE_LIMIT = 20;

/**
 * API 响应中的页面数据结构（`prop=revisions|categories` 查询结果）
 *
 * `titles=` 查询必定返回身份字段，故这三项取必需；`revisions` / `categories`
 * 受 `rvlimit` / `cllimit` 分页影响可能缺席，保持可选。
 */
export type ApiResponsePage =
  QueryPage<'revisions' | 'categories'>
  & Required<Pick<ApiPageIdentity, 'title' | 'pageid' | 'ns'>>;

/** 页面同步所需的依赖上下文（便于脱离 TaskContext 单独测试） */
interface SyncCtx {
  /** 萌百 API 实例 */
  api: MoegirlApi;
  /** 任务日志接口 */
  logger: TaskContext['logger'];
  /** 可取消的延时，用于限流退避 */
  sleep: TaskContext['sleep'];
  /** 应用设置中的请求超时（毫秒），用于推导单页补偿重试的超时 */
  requestTimeout: number;
}

/**
 * 将 API 响应中的页面合并到 Map 中
 *
 * 同一批页面可能因源代码数超过 `rvlimit`、分类数超过 `cllimit` 而在多个续传响应中重复出现：
 * - `rvcontinue` 续传响应返回首次响应因 rvlimit 未含的 revisions，需补回正文与 revid；
 * - `clcontinue` 续传响应只返回被续传的分类、不含 revisions，仅追加分类、沿用已有正文。
 * 故不能因缺少 revisions 就跳过页面，且已有页面在本次响应拿到 revisions 时需更新正文。
 *
 * @param pageMap 累积页面数据的 Map（以标题为键）
 * @param responsePages API 响应中的页面数组
 */
export function mergePages(pageMap: Map<string, PageRecord>, responsePages: ApiResponsePage[]): void {
  for (const page of responsePages) {
    if (page.missing) {
      continue;
    }
    const categories = page.categories?.map((c) => c.title) ?? [];
    const existing = pageMap.get(page.title);
    if (existing) {
      // rvcontinue 续传响应会补回首次响应因 rvlimit 未含的 revisions，需更新正文与 revid；
      // clcontinue 续传响应只含分类、不含 revisions，此时沿用已有正文
      const revision = page.revisions?.[0];
      const content = revision?.slots?.main?.content;
      // 正文为空串（空页面）时按未返回处理，沿用已有正文与 revid
      if (content && revision?.revid !== undefined) {
        existing.text = content.replace(/<!--[\s\S]*?-->/g, '');
        existing.revid = revision.revid;
      }
      existing.categories.push(...categories);
    } else {
      const text = page.revisions?.[0]?.slots?.main?.content?.replace(/<!--[\s\S]*?-->/g, '') ?? '';
      pageMap.set(page.title, {
        title: page.title,
        pageid: page.pageid,
        ns: page.ns,
        revid: page.revisions?.[0]?.revid ?? 0,
        text,
        categories: [...categories],
      });
    }
  }
}

/**
 * 将 Map 中的页面去重分类后批量写入 SQLite
 *
 * @param pageMap 累积页面数据的 Map
 * @returns 本次写入的页面数量
 */
function flushPages(pageMap: Map<string, PageRecord>): number {
  const pages = Array.from(pageMap.values()).map((p) => ({
    ...p,
    categories: [...new Set(p.categories)],
  }));
  upsertPages(pages);
  return pages.length;
}

/** 页面元数据（不含正文，来自 `prop=info` 枚举，用于增量比对与受限页面的版本记录） */
export interface PageMeta {
  /** 页面 ID */
  pageid: number;
  /** 命名空间编号 */
  ns: number;
  /** 最新修订版本 ID */
  revid: number;
  /** 最新修订的正文字节数，用于估算单次内容请求的响应体积 */
  length: number;
}

/**
 * 拉取指定命名空间的页面清单（标题与元数据）
 *
 * 使用 `generator=allpages` + `prop=info`，`gaplimit=max` 翻页。`prop=info` 只取页面元数据、
 * 不请求正文，因此不受敏感页面的读取限制影响（这些页面仍在页面列表中），
 * 其正文在后续按标题补拉时由 {@link fetchTitles} 定位并跳过。
 *
 * @param api 萌百 API 实例
 * @param namespace 命名空间编号（0=主空间, 10=模板空间）
 * @returns 标题到页面元数据的映射
 */
async function fetchNamespaceMeta(api: MoegirlApi, namespace: number): Promise<Map<string, PageMeta>> {
  const result = new Map<string, PageMeta>();
  let gapcontinue: string | false = false;
  do {
    const response: ApiQueryResponse = await api.post<ApiQueryResponse>({
      action: 'query',
      generator: 'allpages',
      gapnamespace: namespace,
      gaplimit: 'max',
      ...(gapcontinue ? { gapcontinue } : {}),
      prop: 'info',
    } satisfies QueryRequest<'info', 'allpages', never, 'allpages'>);
    // 命名空间为空时接口不返回 query 字段
    for (const page of (response.query?.pages ?? []) as InfoPageExisting[]) {
      result.set(page.title, {
        pageid: page.pageid,
        ns: page.ns,
        revid: page.lastrevid,
        length: page.length,
      });
    }
    gapcontinue = response.continue?.gapcontinue || false;
  } while (gapcontinue);
  return result;
}

/**
 * 对比 API 页面清单与本地 DB，计算待补拉与待删除的标题
 *
 * - API 有、DB 无或 revid 不同 -> 待补拉（新增或变更）
 * - DB 有、API 无 -> 待删除（被删除或移走）
 *
 * @param apiMeta API 返回的标题到页面元数据映射
 * @param dbRevids 本地 DB 的标题到 revid 映射
 * @returns 待补拉标题集合与待删除标题集合
 */
export function reconcileRevids(apiMeta: Map<string, PageMeta>, dbRevids: Map<string, number>): {
  titlesToFetch: Set<string>;
  titlesToDelete: Set<string>;
} {
  const titlesToFetch = new Set<string>();
  const titlesToDelete = new Set<string>();
  for (const [title, meta] of apiMeta) {
    const dbRevid = dbRevids.get(title);
    if (dbRevid === undefined || dbRevid !== meta.revid) {
      titlesToFetch.add(title);
    }
  }
  for (const title of dbRevids.keys()) {
    if (!apiMeta.has(title)) {
      titlesToDelete.add(title);
    }
  }
  return { titlesToFetch, titlesToDelete };
}


// #region 批量补拉
//
// 萌百链路不稳定，且条目正文体积差异极大（几百字节到数 MB），一次性请求 500 条正文很容易
// 超时或被中间设备掐断。这里不再按固定的标题数切批、失败后原样重试，而是：
// 1. 用 `prop=info` 的 length 按“标题数 + 预估字节数”双预算打包，从源头避免过大的请求；
// 2. 仍然失败时按体积对半拆，并把后续批次的预算一起下调（不重复撞同一堵墙）；
// 3. 拆到单页仍失败时放大超时时间再试，兜住个别超长条目；
// 4. 个别页面彻底失败只跳过该页（保留库中旧内容），不再让整轮任务失败；
// 5. 连续失败过多则判定链路不可用，中止同步（已入库数据即断点）。

/** 单次内容请求可携带的标题数上限（`titles` 参数上限，机器人账号可达 500） */
const MAX_TITLES_PER_REQUEST = 500;

/** 单次内容请求的正文字节预算初始值（约合 170 条常见长度的条目） */
const INITIAL_BYTE_BUDGET = 2 * 1024 * 1024;

/** 正文字节预算下限，避免链路抖动后批量收缩到不可用的程度 */
const MIN_BYTE_BUDGET = 64 * 1024;

/** 预算回升前需连续成功的批次数 */
const BUDGET_RECOVER_STREAK = 20;

/** 正文长度未知时的估算值（字节） */
const DEFAULT_PAGE_BYTES = 12 * 1024;

/** 单页超时后放大超时时间的倍数 */
const LONG_PAGE_TIMEOUT_FACTOR = 4;

/** 单页补偿重试的超时上限（毫秒），避免链路已断时长时间挂起 */
const MAX_LONG_PAGE_TIMEOUT = 180 * 1000;

/** 限流后的重试次数 */
const RATE_LIMIT_RETRIES = 3;

/** 限流退避的首次间隔（毫秒），之后按重试次数翻倍 */
const RATE_LIMIT_BACKOFF = 5 * 1000;

/** 连续请求失败多少次判定网络不可用并中止同步 */
const MAX_CONSECUTIVE_FAILURES = 6;

/** 连续多少个页面被拒绝访问时判定账号无权读取正文 */
const MAX_CONSECUTIVE_DENIED = 20;

/**
 * 内容请求的分批预算
 *
 * 单批耗时与响应体积正相关，而条目正文的字节数分布极不均匀，只按标题数切批会让
 * “一批里恰好有几个超长条目”的请求反复超时。因此按字节预算打包，并让预算跟随当前网络状况：
 * 失败后减半（后续批次不再重复撞墙），连续成功后缓慢回升，而不是固定在一个对当下链路
 * 偏大或偏小的值。
 */
export class BatchPlanner {
  /** 当前单批正文字节预算 */
  private byteBudget = INITIAL_BYTE_BUDGET;
  /** 连续成功的批次数 */
  private successStreak = 0;

  /** 当前单批正文字节预算（字节），供日志展示 */
  get budget(): number {
    return this.byteBudget;
  }

  /**
   * 按当前预算把标题切成批次
   *
   * 单个标题超过预算时独占一批：它无法再拆，只能靠放大超时时间兜底。
   *
   * @param titles 待拉取标题
   * @param byteLength 预估标题的正文长度（字节）
   */
  *pack(titles: Iterable<string>, byteLength: (title: string) => number): Generator<string[]> {
    let batch: string[] = [];
    let bytes = 0;
    for (const title of titles) {
      const size = byteLength(title);
      if (batch.length > 0 && (batch.length >= MAX_TITLES_PER_REQUEST || bytes + size > this.byteBudget)) {
        yield batch;
        batch = [];
        bytes = 0;
      }
      batch.push(title);
      bytes += size;
    }
    if (batch.length > 0) {
      yield batch;
    }
  }

  /** 记录一次成功：连续成功后缓慢放大预算，恢复到初始值为止 */
  onSuccess(): void {
    this.successStreak++;
    if (this.successStreak < BUDGET_RECOVER_STREAK) {
      return;
    }
    this.successStreak = 0;
    this.byteBudget = Math.min(INITIAL_BYTE_BUDGET, Math.round(this.byteBudget * 1.5));
  }

  /** 记录一次疑似因批量过大导致的失败：预算减半并重新累计成功次数 */
  onOversize(): void {
    this.successStreak = 0;
    this.byteBudget = Math.max(MIN_BYTE_BUDGET, Math.floor(this.byteBudget / 2));
  }
}

/** 批量补拉器的依赖与参数 */
export interface BatchFetcherOptions {
  /** 萌百 API 实例 */
  api: MoegirlApi;
  /** 任务日志接口 */
  logger: TaskContext['logger'];
  /** 可取消的延时，用于限流退避 */
  sleep: TaskContext['sleep'];
  /** 单页补偿重试的超时时间（毫秒） */
  longPageTimeout: number;
  /** 预估标题正文字节数的函数（取自页面清单的 length） */
  byteLength: (title: string) => number;
}

/** 读取错误携带的 API 错误码（对应 `MoegirlRequestError.apiCode`，按属性判断以免引入请求层运行时依赖） */
function apiCodeOf(error: unknown): string | undefined {
  return (error as { apiCode?: string } | null)?.apiCode;
}

/** 读取错误的 HTTP 状态码（无响应时为 undefined，对应 `MoegirlRequestError.detail.status`） */
function statusOf(error: unknown): number | undefined {
  return (error as { detail?: { status?: number } } | null)?.detail?.status;
}

/** 取错误的简短描述，用于日志 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 判断是否为受限页面导致的访问拒绝 */
function isAccessDenied(error: unknown): boolean {
  return apiCodeOf(error) === 'accessdenied';
}

/** 判断是否为请求超时（超时与链路中断在请求层表现一致，补偿方式相同） */
function isTimeout(error: unknown): boolean {
  return (error as { timedOut?: boolean } | null)?.timedOut === true;
}

/**
 * 判断是否为限流或服务端过载
 *
 * 这类错误与单次请求的体积无关，缩小批量只会让请求数更多，应退避后按原批量重试。
 */
function isThrottled(error: unknown): boolean {
  const apiCode = apiCodeOf(error);
  const status = statusOf(error);
  return apiCode === 'maxlag' || apiCode === 'ratelimited' || status === 429 || status === 503;
}

/**
 * 判断错误是否值得通过缩小批量重试
 *
 * 带 API 错误码说明服务端已给出确定性结果（参数非法、权限不足等），缩小批量不会改变结果；
 * 超时、网关错误、连接中断、响应体被替换成错误页都与单次请求的体积和链路状况有关，
 * 拆小后重试多半能成功。
 */
function shouldShrinkBatch(error: unknown): boolean {
  return apiCodeOf(error) === undefined;
}

/**
 * 单次拉取一批标题的正文与分类（含 `rvcontinue` / `clcontinue` 续传）
 *
 * 调用方统一传 `retries: 0`：失败后的处理（拆批、退避、放大超时）由批量层负责，
 * 避免在必然失败的超大请求上先空耗一轮超时时间。
 *
 * @param api 萌百 API 实例
 * @param titles 本批标题
 * @param pageMap 本批页面数据（以标题为键），失败时由调用方整体丢弃
 * @param options 请求选项（超时等）
 */
async function fetchTitleBatch(
  api: MoegirlApi,
  titles: string[],
  pageMap: Map<string, PageRecord>,
  options?: RequestOptions,
): Promise<void> {
  let continueParams: Record<string, unknown> = {};
  do {
    const response: ApiQueryResponse = await api.post<ApiQueryResponse>({
      action: 'query',
      prop: ['revisions', 'categories'],
      titles,
      rvprop: ['content', 'ids'],
      rvslots: 'main',
      cllimit: 'max',
      ...continueParams,
    } satisfies QueryRequest<'revisions' | 'categories'>, options);
    mergePages(pageMap, (response.query?.pages ?? []) as ApiResponsePage[]);
    continueParams = response.continue || {};
  } while (continueParams.clcontinue !== undefined || continueParams.rvcontinue !== undefined);
}

/**
 * 从访问拒绝错误信息中猜测被拒绝的标题
 *
 * 萌百的错误信息会内嵌被拒页面的标题（如 `You are not allowed to view Oo大法好.`），
 * 但信息语言与格式不受控，故仅作为候选：标题列表中出现在错误信息里的标题唯一时才采用，
 * 且采用后仍会单独请求验证（见 {@link BatchFetcher.isolateDenied}）。
 *
 * @param titles 本批标题
 * @param message 访问拒绝错误的信息
 * @returns 候选标题，无法唯一确定时为 undefined
 */
function guessDeniedTitle(titles: string[], message: string): string | undefined {
  const matched = titles.filter((title) => message.includes(title));
  return matched.length === 1 ? matched[0] : undefined;
}

/**
 * 把批次按正文体积对半拆开
 *
 * 按累计字节数而非标题数切分，避免拆出“一半全是大条目”的批次再次超时。
 *
 * @param titles 待拆分的标题列表（长度至少为 2）
 * @param byteLength 预估标题正文长度
 * @returns 两个非空的标题列表
 */
function splitBatch(titles: string[], byteLength: (title: string) => number): [string[], string[]] {
  const half = titles.reduce((sum, title) => sum + byteLength(title), 0) / 2;
  let bytes = 0;
  let cut = 0;
  for (; cut < titles.length - 2; cut++) {
    bytes += byteLength(titles[cut]);
    if (bytes >= half) {
      break;
    }
  }
  return [titles.slice(0, cut + 1), titles.slice(cut + 1)];
}

/**
 * 批量补拉器
 *
 * 持有补拉期间的分批预算与结果集合，并把“失败之后怎么办”的补偿策略收敛在一处：
 * - 访问拒绝：定位并跳过受限标题，不让它拖累同批其他页面
 * - 限流/服务端过载：保持原批量退避重试，缩小批量只会让请求数更多
 * - 超时、网关错误、连接中断：按体积对半拆批重试，后续批次的预算同步下调
 * - 单页仍失败：放大超时时间再试一次，仍失败则记入 {@link failedTitles} 并跳过本轮
 * - 连续失败达到上限：判定网络不可用，抛错中止同步
 *
 * 只有整批请求成功才把页面写入调用方提供的结果集：失败请求可能已经把部分续传响应合并进
 * 页面数据，直接写入会让“正文或分类不全、但 revid 已是新的”状态落库，此后靠 revid 比对
 * 再也无法发现它。
 */
export class BatchFetcher {
  /** 分批预算，失败后自动收缩 */
  readonly planner = new BatchPlanner();

  /** 受限（访问被拒）标题集合，这些标题不入库，下次运行重新确认 */
  readonly deniedTitles = new Set<string>();

  /** 最终未能拉取的标题集合，本轮沿用库中旧内容 */
  readonly failedTitles = new Set<string>();

  /** 萌百 API 实例 */
  private readonly api: MoegirlApi;

  /** 任务日志接口 */
  private readonly logger: TaskContext['logger'];

  /** 可取消的延时，用于限流退避 */
  private readonly sleep: TaskContext['sleep'];

  /** 单页补偿重试的超时时间（毫秒） */
  private readonly longPageTimeout: number;

  /** 预估标题正文字节数的函数（取自页面清单的 length） */
  private readonly byteLength: (title: string) => number;

  /** 连续失败的请求数，达到上限时判定网络不可用 */
  private failureStreak = 0;

  /** 连续被拒绝访问的页面数，用于识别“账号整体没有读取权限”而非个别敏感页面 */
  private deniedStreak = 0;

  /** 本次运行累计成功入库的页面数，用于判断是“整体无权限”还是“个别敏感页面” */
  private committed = 0;

  /**
   * @param options 依赖与参数
   */
  constructor(options: BatchFetcherOptions) {
    this.api = options.api;
    this.logger = options.logger;
    this.sleep = options.sleep;
    this.longPageTimeout = options.longPageTimeout;
    this.byteLength = options.byteLength;
  }

  /**
   * 按当前预算把标题切成批次
   *
   * @param titles 待拉取标题
   */
  *pack(titles: Iterable<string>): Generator<string[]> {
    yield* this.planner.pack(titles, this.byteLength);
  }

  /**
   * 拉取一组标题的正文与分类，失败时按原因补偿
   *
   * @param titles 本次要拉取的标题
   * @param sink 成功页面的收集器
   * @param throttledAttempts 已因限流重试的次数（内部递归用）
   */
  async fetch(titles: string[], sink: Map<string, PageRecord>, throttledAttempts = 0): Promise<void> {
    if (titles.length === 0) {
      return;
    }
    const fetched = new Map<string, PageRecord>();
    try {
      await fetchTitleBatch(this.api, titles, fetched, { retries: 0 });
    } catch (error) {
      await this.recover(titles, sink, error, throttledAttempts);
      return;
    }
    this.commit(fetched, sink);
  }

  /**
   * 单批请求失败后的补偿分支
   *
   * @param titles 失败批次的标题
   * @param sink 结果收集器
   * @param error 请求抛出的错误
   * @param throttledAttempts 已因限流重试的次数
   */
  private async recover(
    titles: string[],
    sink: Map<string, PageRecord>,
    error: unknown,
    throttledAttempts: number,
  ): Promise<void> {
    if (isAccessDenied(error)) {
      // 受限页面不是网络问题，不参与连续失败计数
      await this.isolateDenied(titles, sink, errorMessage(error));
      return;
    }

    this.recordFailure(error);

    if (isThrottled(error)) {
      if (throttledAttempts >= RATE_LIMIT_RETRIES) {
        this.fail(titles, error);
        return;
      }
      await this.sleep(RATE_LIMIT_BACKOFF * 2 ** throttledAttempts);
      await this.fetch(titles, sink, throttledAttempts + 1);
      return;
    }

    // 服务端给出了确定性错误（参数非法等），重试结果不变，交给 runner 记录
    if (!shouldShrinkBatch(error)) {
      throw error;
    }

    if (titles.length > 1) {
      this.planner.onOversize();
      const [head, tail] = splitBatch(titles, this.byteLength);
      this.logger.info(
        `本批${titles.length}个页面拉取失败（${errorMessage(error)}），拆成${head.length}+${tail.length}个重试，后续批次预算降至${Math.round(this.planner.budget / 1024)}KB`,
      );
      await this.fetch(head, sink);
      await this.fetch(tail, sink);
      return;
    }

    await this.retrySingle(titles[0], sink, error);
  }

  /**
   * 从整批被拒的请求中定位受限标题
   *
   * 敏感页面的读取限制对整批 `titles` 请求生效：响应只含一个 `accessdenied` 错误、不含任何页面数据，
   * 因此需要把该标题从批次中剔除后重新请求其余页面：
   * - 错误信息内嵌标题时，先单独请求该标题验证，命中则其余标题一次拉完（避免二分）
   * - 无法从错误信息定位时二分标题列表，逐步缩小到单个标题
   * 单个标题仍被拒绝即认定该页面受限，记入 `deniedTitles` 并跳过（不入库，下次运行会重新确认）。
   *
   * @param titles 被整批拒绝的标题
   * @param sink 结果收集器
   * @param message 访问拒绝错误的信息
   */
  private async isolateDenied(titles: string[], sink: Map<string, PageRecord>, message: string): Promise<void> {
    if (titles.length === 1) {
      this.markDenied(titles[0]);
      return;
    }
    const suspect = guessDeniedTitle(titles, message);
    if (suspect !== undefined) {
      await this.fetch([suspect], sink);
      await this.fetch(titles.filter((title) => title !== suspect), sink);
      return;
    }
    const [head, tail] = splitBatch(titles, this.byteLength);
    await this.fetch(head, sink);
    await this.fetch(tail, sink);
  }

  /**
   * 单页失败后的最后一次尝试
   *
   * 单页已经无法再拆。超时说明这一页在当前链路下确实传不完（萌百存在数 MB 的超长条目），
   * 只能放大超时时间；网关错误、连接中断等则按默认超时重试一次即可。
   *
   * @param title 失败的标题
   * @param sink 结果收集器
   * @param cause 首次失败的错误
   */
  private async retrySingle(title: string, sink: Map<string, PageRecord>, cause: unknown): Promise<void> {
    /** 超时才需要放大超时时间，其它错误用应用设置里的默认值 */
    const options: RequestOptions = { retries: 0 };
    if (isTimeout(cause)) {
      options.timeout = this.longPageTimeout;
    }
    const fetched = new Map<string, PageRecord>();
    try {
      await fetchTitleBatch(this.api, [title], fetched, options);
    } catch (error) {
      if (isAccessDenied(error)) {
        this.markDenied(title);
        return;
      }
      this.recordFailure(error);
      this.fail([title], error);
      return;
    }
    this.commit(fetched, sink);
    this.logger.info(`页面[[${title}]]重试成功（${errorMessage(cause)}）`);
  }

  /**
   * 接收一批成功的请求结果
   *
   * @param fetched 本批拉取到的页面
   * @param sink 结果收集器
   */
  private commit(fetched: Map<string, PageRecord>, sink: Map<string, PageRecord>): void {
    this.failureStreak = 0;
    this.deniedStreak = 0;
    this.committed += fetched.size;
    this.planner.onSuccess();
    for (const [title, page] of fetched) {
      sink.set(title, page);
    }
  }

  /**
   * 记录一次请求失败
   *
   * 连续失败达到上限说明链路整体不可用，继续逐批重试只会让任务空转，直接抛错中止同步；
   * 已入库的页面即断点，下次运行会从失败处继续。
   *
   * @throws 连续失败次数达到 {@link MAX_CONSECUTIVE_FAILURES} 时抛出
   */
  private recordFailure(error: unknown): void {
    this.failureStreak++;
    if (this.failureStreak >= MAX_CONSECUTIVE_FAILURES) {
      throw new Error(`连续${MAX_CONSECUTIVE_FAILURES}次请求失败，网络可能不可用，本次同步中止`, { cause: error });
    }
  }

  /**
   * 记录一个受限标题
   *
   * 一轮里从未成功拉到任何页面、又连续大量页面被拒，说明不是个别敏感页面，而是账号没有读取正文的
   * 权限（萌百对未登录用户限制 `rvprop=content`），此时继续二分只会白耗请求，直接中止同步。
   * 这些页面一旦被记为“无变化”写入库，后续运行就再也不会重新拉取，因此必须在写库前拦住。
   *
   * @throws 无任何成功记录且连续被拒页面数达到 {@link MAX_CONSECUTIVE_DENIED} 时抛出
   */
  private markDenied(title: string): void {
    this.deniedTitles.add(title);
    this.deniedStreak++;
    // 已经成功拉到过页面说明账号有读取权限，连续被拒只可能是标题相邻的敏感页面，按页跳过即可
    if (this.committed === 0 && this.deniedStreak >= MAX_CONSECUTIVE_DENIED) {
      throw new Error(`连续${MAX_CONSECUTIVE_DENIED}个页面均被拒绝访问，可能当前账号无权读取页面源代码，本次同步中止`);
    }
  }

  /**
   * 标记一批页面彻底失败
   *
   * 失败页面的正文不会写入库（保留旧内容或保持缺失），下次运行的 revid 比对会再次拉取，
   * 因此不影响数据正确性，只是本轮检查用的是旧内容。
   *
   * @param titles 失败的标题
   * @param error 失败原因
   */
  private fail(titles: string[], error: unknown): void {
    for (const title of titles) {
      this.failedTitles.add(title);
    }
    const target = titles.length === 1 ? `页面[[${titles[0]}]]` : `${titles.length}个页面`;
    this.logger.warn(`${target}拉取失败，本轮跳过：${errorMessage(error)}`);
  }
}

/**
 * 按标题批量拉取页面内容与分类并写入 SQLite
 *
 * 用于比对后变更/新增页的正文补拉。跳过 `missing` 页面（由 {@link mergePages} 处理）
 * 与 `ns` 非 0/10 的页面（避免把移出主/模板空间的页面入库）。
 *
 * @param ctx 依赖上下文
 * @param titles 待拉取标题集合
 * @param apiMeta 页面清单，提供各页面的正文字节数用于分批估算
 * @returns 受限标题集合与最终失败标题集合
 */
async function fetchPagesByTitles(
  ctx: SyncCtx,
  titles: Set<string>,
  apiMeta: Map<string, PageMeta>,
): Promise<{ denied: Set<string>; failed: Set<string> }> {
  const { api, logger, sleep, requestTimeout } = ctx;
  const fetcher = new BatchFetcher({
    api,
    logger,
    sleep,
    longPageTimeout: Math.min(MAX_LONG_PAGE_TIMEOUT, requestTimeout * LONG_PAGE_TIMEOUT_FACTOR),
    byteLength: (title) => apiMeta.get(title)?.length ?? DEFAULT_PAGE_BYTES,
  });

  let written = 0;
  let logged = 0;
  for (const batch of fetcher.pack(titles)) {
    const pageMap = new Map<string, PageRecord>();
    await fetcher.fetch(batch, pageMap);

    // 剔除 ns 非 0/10 的页面（移出主/模板空间的目标页不入库）
    for (const [title, page] of pageMap) {
      if (!TRACKED_NAMESPACES.includes(page.ns)) {
        pageMap.delete(title);
      }
    }
    written += flushPages(pageMap);
    if (written - logged >= LOG_INTERVAL) {
      logged = written;
      logger.info(`已补拉${written}个页面`);
    }
  }
  logger.info(`补拉完毕，共写入${written}个页面`);
  return { denied: fetcher.deniedTitles, failed: fetcher.failedTitles };
}

// #endregion


/**
 * 将标题列表格式化为日志文本，超出上限时截断
 *
 * @param titles 标题列表
 * @returns 以`、`分隔的`[[标题]]`列表，超出上限时附总数
 */
function formatTitleList(titles: string[]): string {
  const shown = titles.slice(0, LOG_TITLE_LIMIT).map((title) => `[[${title}]]`).join('、');
  return titles.length > LOG_TITLE_LIMIT ? `${shown}等${titles.length}个` : shown;
}

/**
 * 同步全站页面数据到本地 SQLite
 *
 * 先按命名空间拉取标题与元数据清单，再与本地库比对，最后补拉变更/新增页并删除过期页。
 * 本地库即断点：首次运行等价于全量拉取，中断后下次运行按 revid 比对自动续传（已入库的页面不会重复拉取）。
 * 删除在补拉之后执行，确保中断时不会误删尚未补拉的页面。
 *
 * @param ctx 依赖上下文
 */
async function syncPages(ctx: SyncCtx): Promise<void> {
  const { api, logger } = ctx;
  logger.info('开始拉取页面清单……');
  const apiMeta = new Map<string, PageMeta>();
  for (const ns of TRACKED_NAMESPACES) {
    const metas = await fetchNamespaceMeta(api, ns);
    for (const [title, meta] of metas) {
      apiMeta.set(title, meta);
    }
    logger.info(`命名空间${ns}：${metas.size}个页面`);
  }
  logger.info(`页面清单拉取完毕，共${apiMeta.size}个页面`);
  if (apiMeta.size === 0) {
    // 清单为空会把本地库当成“全部页面已删除”，宁可中止也不能误删数据
    throw new Error('页面清单为空，可能是接口异常，已中止同步以避免误删本地数据');
  }

  const dbRevids = getPageRevids();
  const { titlesToFetch, titlesToDelete } = reconcileRevids(apiMeta, dbRevids);
  logger.info(`比对完毕：待补拉${titlesToFetch.size}个、待删除${titlesToDelete.size}个`);

  const { denied, failed } = await fetchPagesByTitles(ctx, titlesToFetch, apiMeta);
  if (denied.size > 0) {
    // 受限页面仅覆盖最新 revid、正文保持不变：后续增量比对视为无变化，不再重复请求；
    // 页面被编辑（revid 变化）或解禁后会重新进入待补拉
    const records = [...denied].flatMap((title) => {
      const meta = apiMeta.get(title);
      return meta ? [{ title, pageid: meta.pageid, ns: meta.ns, revid: meta.revid }] : [];
    });
    upsertPageMetas(records);
    logger.warn(`跳过${denied.size}个受限页面：${formatTitleList([...denied])}`);
  }
  if (failed.size > 0) {
    // 失败页面未入库，本轮检查沿用库中旧内容；不在库中的新页面本轮会被跳过，下次运行重新拉取
    logger.warn(`有${failed.size}个页面本轮未能拉取，检查将使用库中已有内容：${formatTitleList([...failed])}`);
  }

  if (titlesToDelete.size > 0) {
    const deleted = deletePages([...titlesToDelete]);
    logger.info(`已删除${deleted}个过期页面`);
  }
}

/**
 * 更新[[User:BearBin/杂物]]页面
 *
 * 检查全站页面和模板中的各类格式问题，生成报告并保存到用户子页面。
 * 首次运行全量获取页面数据存储到本地 SQLite，后续运行通过 revid 比对增量更新。
 */
const messUpdater: TaskHandler = async ({ api, logger, signal, sleep }) => {
  const messOutput = new MessOutput(structuredClone(MESS_DATA));

  // #region 获取页顶提示模板列表

  /** 获取 [[Category:页顶提示模板]] 下的模板名列表（已去除 Template: 前缀） */
  const fetchTopTipTemplates = async (): Promise<string[]> => {
    const members = await api.fetchCategoryMembers('Category:页顶提示模板', { cmprop: 'title' });
    const templates: string[] = [];
    for (const member of members) {
      const name = member.title.replace('Template:', '');
      if (!EXCLUDED_TOP_TIPS.includes(name)) {
        templates.push(name);
      }
    }
    logger.info(`获取到${templates.length}个页顶提示模板`);
    return templates;
  };

  const topTipTemplates = await fetchTopTipTemplates();

  // #endregion


  // #region 获取页面数据（首次运行等价于全量，之后按 revid 增量）

  await syncPages({ api, logger, sleep, requestTimeout: getAllSettings().requestTimeout });

  // #endregion


  // #region 从本地流式读取页面并执行检查

  logger.info(`本地共${getPageCount()}个页面，开始执行检查`);

  const mainChecks = createMainChecks({ messOutput, topTipTemplates });
  const templateChecks = createTemplateChecks({ messOutput, topTipTemplates });

  /** 命名空间到检查函数列表的映射 */
  const checksByNamespace = new Map<number, ReturnType<typeof createMainChecks>>([
    [0, mainChecks],
    [10, templateChecks],
  ]);

  let checkedCount = 0;
  for await (const page of iteratePages()) {
    signal.throwIfAborted();
    const checks = checksByNamespace.get(page.ns);
    if (checks) {
      for (const check of checks) {
        check(page.text, page.categories, page.title);
      }
    }
    checkedCount++;
    if (checkedCount % LOG_INTERVAL === 0) {
      logger.info(`已检查${checkedCount}个页面`);
    }
  }
  logger.info(`检查完毕，共检查${checkedCount}个页面`);

  // #endregion


  // #region 获取疑似繁体页面名

  /**
   * 获取指定命名空间的疑似繁体页面名
   *
   * 通过 `prop=info` + `inprop=varianttitles` 获取页面的简体变体标题，
   * 与原标题对比，若不同则视为疑似繁体命名。
   *
   * @param namespace 命名空间编号（0=主空间, 10=模板空间, 14=分类空间）
   */
  const fetchVariantTitles = async (namespace: number): Promise<void> => {
    let gapcontinue: string | false = false;
    do {
      const response: ApiQueryResponse = await api.post<ApiQueryResponse>({
        action: 'query',
        prop: 'info',
        generator: 'allpages',
        inprop: 'varianttitles',
        gapfilterredir: 'nonredirects',
        gaplimit: 'max',
        gapnamespace: namespace,
        ...(gapcontinue ? { gapcontinue } : {}),
      } satisfies QueryRequest<'info', 'allpages', never, 'allpages'>);
      gapcontinue = response.continue?.gapcontinue || false;
      // 命名空间为空时接口不返回 query 字段
      for (const page of (response.query?.pages ?? []) as InfoPageExisting[]) {
        const titleCN = page.varianttitles?.['zh-cn'];
        if (
          titleCN &&
          !/[ぁ-んァ-ヶ]/.test(page.title) &&
          page.title.replace(/^(?:Category|Template):/, '') !== titleCN.replace(/^(?:分类|模板):/, '')
        ) {
          messOutput.addPageToList('疑似繁体页面名', [`:${page.title}`, `→${titleCN}`]);
        }
      }
    } while (gapcontinue);
  };

  await fetchVariantTitles(0);
  logger.info('主名字空间疑似繁体命名检查完毕');
  await fetchVariantTitles(10);
  logger.info('模板名字空间疑似繁体命名检查完毕');
  await fetchVariantTitles(14);
  logger.info('分类空间疑似繁体命名检查完毕');

  // #endregion

  // #region 保存到萌百

  const targetPage = 'User:BearBin/杂物';
  await api.editPage(targetPage, messOutput.wikitext, '自动更新列表', { timeout: 60000 });

  // #endregion

  logger.info('任务完成');
};

export default messUpdater;
