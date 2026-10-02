import type { ApiPageIdentity, ApiQueryResponse, InfoPageExisting, QueryPage } from 'types-mediawiki-response';
import type { TaskContext, TaskHandler } from '../../services/tasks/types';
import type { MoegirlApi } from '../../services/moegirl';
import { deletePages, getPageCount, getPageRevids, iteratePages, upsertPageMetas, upsertPages, type PageRecord } from './page-store';
import { createMainChecks, createTemplateChecks } from './checks';
import { MESS_DATA, MessOutput } from './output';

/** 需要排除的页顶提示模板名称 */
const EXCLUDED_TOP_TIPS = ['架空历史'];

/** 检查进度日志的输出间隔（条目数） */
const LOG_INTERVAL = 20000;

/** 本任务追踪的命名空间（主空间与模板空间） */
const TRACKED_NAMESPACES = [0, 10];

/** 单批补拉标题数量（`titles` 参数上限，机器人账号可达 500） */
const TITLE_BATCH = 500;

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
}

/**
 * 拉取指定命名空间的页面清单（标题与元数据）
 *
 * 使用 `generator=allpages` + `prop=info`，`gaplimit=max` 翻页。`prop=info` 只取页面元数据、
 * 不请求正文，因此不受敏感页面的读取限制影响（这些页面仍在页面列表中），
 * 其正文在后续按标题补拉时由 {@link fetchPagesWithDeniedIsolation} 定位并跳过。
 *
 * @param ctx 依赖上下文
 * @param namespace 命名空间编号（0=主空间, 10=模板空间）
 * @returns 标题到页面元数据的映射
 */
async function fetchNamespaceMeta(ctx: SyncCtx, namespace: number): Promise<Map<string, PageMeta>> {
  const { api } = ctx;
  const result = new Map<string, PageMeta>();
  let gapcontinue: string | false = false;
  do {
    const response: ApiQueryResponse = await api.post<ApiQueryResponse>({
      action: 'query',
      generator: 'allpages',
      gapnamespace: namespace,
      gaplimit: 'max',
      gapcontinue,
      prop: 'info',
    });
    for (const page of (response.query.pages ?? []) as InfoPageExisting[]) {
      result.set(page.title, { pageid: page.pageid, ns: page.ns, revid: page.lastrevid });
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

/**
 * 单次拉取一批标题的正文与分类（含续传）
 *
 * @param api 萌百 API 实例
 * @param titles 本批标题
 * @param pageMap 累积页面数据的 Map（以标题为键）
 */
async function fetchTitleBatch(api: MoegirlApi, titles: string[], pageMap: Map<string, PageRecord>): Promise<void> {
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
    });
    mergePages(pageMap, (response.query.pages ?? []) as ApiResponsePage[]);
    continueParams = response.continue || {};
  } while (continueParams.clcontinue !== undefined || continueParams.rvcontinue !== undefined);
}

/**
 * 判断错误是否为受限页面（敏感内容）导致的访问拒绝
 *
 * 按错误码判断而不依赖 `instanceof`，使本模块不必引入请求层的运行时依赖。
 */
function isAccessDenied(error: unknown): boolean {
  return (error as { apiCode?: string } | null)?.apiCode === 'accessdenied';
}

/**
 * 从访问拒绝错误信息中猜测被拒绝的标题
 *
 * 萌百的错误信息会内嵌被拒页面的标题（如 `You are not allowed to view Oo大法好.`），
 * 但信息语言与格式不受控，故仅作为候选：标题列表中出现在错误信息里的标题唯一时才采用，
 * 且采用后仍会单独请求验证（见 {@link fetchPagesWithDeniedIsolation}）。
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
 * 拉取一批标题的正文，遇到受限页面时定位并跳过
 *
 * 敏感页面的读取限制对整批 `titles` 请求生效：响应只含一个 `accessdenied` 错误、不含任何页面数据，
 * 因此需把该标题从批次中剔除后重试。定位策略：
 * - 错误信息内嵌标题时，先单独请求该标题验证，命中则其余标题一次拉完（避免二分）
 * - 无法从错误信息定位时二分标题列表，逐步缩小到单个标题
 * 单个标题仍被拒绝即认定该页面受限，记入 `deniedTitles` 并跳过（不入库，下次运行会重新确认）。
 *
 * @param api 萌百 API 实例
 * @param titles 本批标题
 * @param pageMap 累积页面数据的 Map（以标题为键）
 * @param deniedTitles 受限标题集合，命中的标题追加到其中
 */
export async function fetchPagesWithDeniedIsolation(
  api: MoegirlApi,
  titles: string[],
  pageMap: Map<string, PageRecord>,
  deniedTitles: Set<string>,
): Promise<void> {
  if (titles.length === 0) {
    return;
  }
  try {
    await fetchTitleBatch(api, titles, pageMap);
  } catch (error) {
    if (!isAccessDenied(error)) {
      throw error;
    }
    if (titles.length === 1) {
      deniedTitles.add(titles[0]);
      return;
    }
    const suspect = guessDeniedTitle(titles, (error as Error).message);
    if (suspect !== undefined) {
      await fetchPagesWithDeniedIsolation(api, [suspect], pageMap, deniedTitles);
      await fetchPagesWithDeniedIsolation(api, titles.filter((title) => title !== suspect), pageMap, deniedTitles);
      return;
    }
    const mid = Math.ceil(titles.length / 2);
    await fetchPagesWithDeniedIsolation(api, titles.slice(0, mid), pageMap, deniedTitles);
    await fetchPagesWithDeniedIsolation(api, titles.slice(mid), pageMap, deniedTitles);
  }
}

/**
 * 按标题批量拉取页面内容与分类并写入 SQLite
 *
 * 用于比对后变更/新增页的正文补拉。复用 {@link mergePages}/{@link flushPages}，
 * 跳过 `missing` 页面（由 mergePages 处理）与 `ns` 非 0/10 的页面（避免把移出主/模板空间的页面入库）。
 *
 * @param ctx 依赖上下文
 * @param titles 待拉取标题集合
 * @returns 被拒绝访问（受限）的标题集合
 */
async function fetchPagesByTitles(ctx: SyncCtx, titles: Set<string>): Promise<Set<string>> {
  const { api, logger } = ctx;
  const deniedTitles = new Set<string>();
  if (titles.size === 0) {
    return deniedTitles;
  }
  const titleList = [...titles];
  let count = 0;
  for (let i = 0; i < titleList.length; i += TITLE_BATCH) {
    const pageMap = new Map<string, PageRecord>();
    await fetchPagesWithDeniedIsolation(api, titleList.slice(i, i + TITLE_BATCH), pageMap, deniedTitles);
    // 剔除 ns 非 0/10 的页面（移出主/模板空间的目标页不入库）
    for (const [title, page] of pageMap) {
      if (!TRACKED_NAMESPACES.includes(page.ns)) {
        pageMap.delete(title);
      }
    }
    count += flushPages(pageMap);
    if (count > 0 && count % LOG_INTERVAL < TITLE_BATCH) {
      logger.info(`已补拉${count}个页面`);
    }
  }
  logger.info(`补拉完毕，共写入${count}个页面`);
  return deniedTitles;
}

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
  const { logger } = ctx;
  logger.info('开始拉取页面清单……');
  const apiMeta = new Map<string, PageMeta>();
  for (const ns of TRACKED_NAMESPACES) {
    const metas = await fetchNamespaceMeta(ctx, ns);
    for (const [title, meta] of metas) {
      apiMeta.set(title, meta);
    }
    logger.info(`命名空间${ns}：${metas.size}个页面`);
  }
  logger.info(`页面清单拉取完毕，共${apiMeta.size}个页面`);

  const dbRevids = getPageRevids();
  const { titlesToFetch, titlesToDelete } = reconcileRevids(apiMeta, dbRevids);
  logger.info(`比对完毕：待补拉${titlesToFetch.size}个、待删除${titlesToDelete.size}个`);

  const deniedTitles = await fetchPagesByTitles(ctx, titlesToFetch);
  if (deniedTitles.size > 0) {
    // 受限页面仅覆盖最新 revid、正文保持不变：后续增量比对视为无变化，不再重复请求；
    // 页面被编辑（revid 变化）或解禁后会重新进入待补拉
    const records = [...deniedTitles].flatMap((title) => {
      const meta = apiMeta.get(title);
      return meta ? [{ title, ...meta }] : [];
    });
    upsertPageMetas(records);
    logger.warn(`跳过${deniedTitles.size}个受限页面：${formatTitleList([...deniedTitles])}`);
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
const messUpdater: TaskHandler = async ({ api, logger, signal }) => {
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

  await syncPages({ api, logger });

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
        gapcontinue,
      });
      gapcontinue = response.continue?.gapcontinue || false;
      for (const page of (response.query.pages ?? []) as InfoPageExisting[]) {
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
