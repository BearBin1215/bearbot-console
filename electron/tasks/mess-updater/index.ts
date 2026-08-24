import type { TaskContext, TaskHandler } from '../../services/tasks/types';
import type { MoegirlApi, RevisionSlots, TitleEntry } from '../../services/moegirl';
import { deletePages, getPageCount, getPageRevids, iteratePages, upsertPages, type PageRecord } from './page-store';
import { createMainChecks, createTemplateChecks } from './checks';
import { MESS_DATA, MessOutput } from './output';
import { clearProgress, loadProgress, saveProgress } from './progress';

/** 需要排除的页顶提示模板名称 */
const EXCLUDED_TOP_TIPS = ['架空历史'];

/** 检查进度日志的输出间隔（条目数） */
const LOG_INTERVAL = 20000;

/** 本任务追踪的命名空间（主空间与模板空间） */
const TRACKED_NAMESPACES = [0, 10];

/** API 响应中的页面数据结构 */
export interface ApiResponsePage {
  /** 页面标题 */
  title: string;
  /** 页面 ID */
  pageid: number;
  /** 命名空间编号 */
  ns: number;
  /** 修订信息（含页面源代码和修订版本 ID） */
  revisions?: Array<RevisionSlots & { revid: number }>;
  /** 所属分类列表 */
  categories?: Array<TitleEntry>;
  /** 页面是否存在（缺失时为 true） */
  missing?: boolean;
}

/** 增量同步所需的依赖上下文（便于脱离 TaskContext 单独测试） */
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
      if (page.revisions?.[0]?.slots?.main?.content) {
        existing.text = page.revisions[0].slots.main.content.replace(/<!--[\s\S]*?-->/g, '');
        existing.revid = page.revisions[0].revid;
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

/** API 响应中仅含 revid 的页面数据结构（全量 revid 清单拉取用） */
interface ApiRevidPage {
  /** 页面标题 */
  title: string;
  /** 修订信息（仅含 revid，无正文） */
  revisions?: Array<{ revid: number }>;
}

/**
 * 拉取指定命名空间的全量页面标题与 revid 清单
 *
 * 使用 `generator=allpages` + `prop=revisions` + `rvprop=ids`，`gaplimit=max` 翻页。
 * 因 `rvprop=ids` 不含正文，每页仅一条 revision，不产生 `rvcontinue`，仅 `gapcontinue` 翻页。
 *
 * @param ctx 依赖上下文
 * @param namespace 命名空间编号（0=主空间, 10=模板空间）
 * @returns 标题到 revid 的映射
 */
async function fetchPageRevids(ctx: SyncCtx, namespace: number): Promise<Map<string, number>> {
  const { api } = ctx;
  const result = new Map<string, number>();
  let gapcontinue: string | false = false;
  do {
    const response = await api.post({
      action: 'query',
      generator: 'allpages',
      gapnamespace: namespace,
      gaplimit: 'max',
      gapcontinue,
      prop: 'revisions',
      rvprop: 'ids',
    });
    for (const page of response.query.pages as ApiRevidPage[]) {
      const revid = page.revisions?.[0]?.revid;
      if (revid !== undefined) {
        result.set(page.title, revid);
      }
    }
    gapcontinue = response.continue?.gapcontinue || false;
  } while (gapcontinue);
  return result;
}

/**
 * 对比 API revid 清单与本地 DB，计算待补拉与待删除的标题
 *
 * - API 有、DB 无或 revid 不同 -> 待补拉（新增或变更）
 * - DB 有、API 无 -> 待删除（被删除或移走）
 *
 * @param apiRevids API 返回的标题到 revid 映射
 * @param dbRevids 本地 DB 的标题到 revid 映射
 * @returns 待补拉标题集合与待删除标题集合
 */
export function reconcileRevids(apiRevids: Map<string, number>, dbRevids: Map<string, number>): {
  titlesToFetch: Set<string>;
  titlesToDelete: Set<string>;
} {
  const titlesToFetch = new Set<string>();
  const titlesToDelete = new Set<string>();
  for (const [title, apiRevid] of apiRevids) {
    const dbRevid = dbRevids.get(title);
    if (dbRevid === undefined || dbRevid !== apiRevid) {
      titlesToFetch.add(title);
    }
  }
  for (const title of dbRevids.keys()) {
    if (!apiRevids.has(title)) {
      titlesToDelete.add(title);
    }
  }
  return { titlesToFetch, titlesToDelete };
}

/**
 * 按标题批量拉取页面内容与分类并写入 SQLite
 *
 * 用于比对后变更/新增页的内容补拉。复用 {@link mergePages}/{@link flushPages}，
 * 跳过 `missing` 页面（由 mergePages 处理）与 `ns` 非 0/10 的页面（避免把移出主/模板空间的页面入库）。
 *
 * @param ctx 依赖上下文
 * @param titles 待拉取标题集合
 */
async function fetchPagesByTitles(ctx: SyncCtx, titles: Set<string>): Promise<void> {
  const { api, logger } = ctx;
  if (titles.size === 0) {
    return;
  }
  const titleList = [...titles];
  /** 单批标题数量（titles 参数上限，bot 可达 500） */
  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < titleList.length; i += BATCH) {
    const batch = titleList.slice(i, i + BATCH);
    const pageMap = new Map<string, PageRecord>();
    let continueParams: Record<string, unknown> = {};
    do {
      const response = await api.post({
        action: 'query',
        prop: ['revisions', 'categories'],
        titles: batch,
        rvprop: ['content', 'ids'],
        rvslots: 'main',
        cllimit: 'max',
        ...continueParams,
      });
      mergePages(pageMap, response.query.pages as ApiResponsePage[]);
      continueParams = response.continue || {};
    } while (continueParams.clcontinue !== undefined || continueParams.rvcontinue !== undefined);
    // 剔除 ns 非 0/10 的页面（移出主/模板空间的目标页不入库）
    for (const [title, page] of pageMap) {
      if (!TRACKED_NAMESPACES.includes(page.ns)) {
        pageMap.delete(title);
      }
    }
    count += flushPages(pageMap);
  }
  logger.info(`补拉完毕，共写入${count}个页面`);
}

/**
 * 执行增量同步：拉取 revid 清单 -> 比对 -> 补拉变更页 -> 删除过期页
 *
 * 先完整拉取两个命名空间的 revid 清单，再与本地 DB 比对，最后补拉变更页并删除过期页。
 * 删除在补拉之后执行，确保中断时不会误删尚未补拉的页面。
 *
 * @param ctx 依赖上下文
 */
async function syncIncremental(ctx: SyncCtx): Promise<void> {
  const { logger } = ctx;
  logger.info('开始拉取页面 revid 清单……');
  const apiRevids = new Map<string, number>();
  for (const ns of TRACKED_NAMESPACES) {
    const revids = await fetchPageRevids(ctx, ns);
    for (const [title, revid] of revids) {
      apiRevids.set(title, revid);
    }
    logger.info(`命名空间${ns}：${revids.size}个页面`);
  }
  logger.info(`revid 清单拉取完毕，共${apiRevids.size}个页面`);

  const dbRevids = getPageRevids();
  const { titlesToFetch, titlesToDelete } = reconcileRevids(apiRevids, dbRevids);
  logger.info(`比对完毕：待补拉${titlesToFetch.size}个、待删除${titlesToDelete.size}个`);

  await fetchPagesByTitles(ctx, titlesToFetch);

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
    const templates: string[] = [];
    let cmcontinue: string | false = false;
    do {
      const response = await api.post({
        action: 'query',
        list: 'categorymembers',
        cmlimit: 'max',
        cmtitle: 'Category:页顶提示模板',
        cmcontinue,
      });
      cmcontinue = response.continue?.cmcontinue || false;
      for (const member of response.query.categorymembers as Array<{ title: string }>) {
        const name = member.title.replace('Template:', '');
        if (!EXCLUDED_TOP_TIPS.includes(name)) {
          templates.push(name);
        }
      }
    } while (cmcontinue);
    logger.info(`获取到${templates.length}个页顶提示模板`);
    return templates;
  };

  const topTipTemplates = await fetchTopTipTemplates();

  // #endregion


  // #region 获取页面数据（全量或增量）
  //
  // 全量获取耗时长且易因网络中断失败，按命名空间持久化 gapcontinue 断点：
  // - 存在未完成断点时从断点继续（已完成的命名空间跳过，避免重复拉取）
  // - 首次运行（无断点且本地无数据）从零开始全量获取
  // - 本地已有数据且无断点时走增量比对

  /**
   * 全量获取指定命名空间的页面并写入 SQLite
   *
   * 使用 `generator=allpages` + `prop=revisions|categories`。
   * 采用父子循环：外层 `gapcontinue` 遍历页面批次，内层 `clcontinue` 累积同一批页面的全部分类。
   * 当响应中返回 `gapcontinue` 时表示当前批次分类获取完毕，将累积数据写入 SQLite。
   * 每批写入后保存 gapcontinue 断点，支持中断续传；全部完成后清除断点。
   *
   * @param namespace 命名空间编号（0=主空间, 10=模板空间）
   * @param resumeGapcontinue 断点续传的起始 gapcontinue（可选，未传从零开始）
   */
  const fetchAllPagesContent = async (namespace: number, resumeGapcontinue?: string): Promise<void> => {
    logger.info(`开始全量获取命名空间${namespace}的页面……`);
    let gapcontinue: string | false = resumeGapcontinue ?? false;
    let count = 0;
    do {
      const pageMap = new Map<string, PageRecord>();
      let continueParams: Record<string, unknown> = {};
      let nextGapcontinue: string | false = false;
      do {
        const response = await api.post({
          action: 'query',
          generator: 'allpages',
          gapnamespace: namespace,
          gaplimit: 'max',
          gapcontinue,
          prop: ['revisions', 'categories'],
          rvprop: ['content', 'ids'],
          rvslots: 'main',
          cllimit: 'max',
          ...continueParams,
        }, { timeout: 45000 });
        mergePages(pageMap, response.query.pages as ApiResponsePage[]);
        const cont = response.continue || {};
        if (cont.gapcontinue) {
          nextGapcontinue = cont.gapcontinue;
        }
        // 保留 prop 级续传参数（rvcontinue/clcontinue）以及 continue 排序标记一并回传，仅剔除 gapcontinue（由外层循环处理）。
        // continue 标记不可丢弃：revisions 的 rvlimit（500）远小于 gaplimit（5000），一个批次需多次 rvcontinue 才能取完全部源代码；
        // 缺少该标记时 API 不会续传 revisions，导致除首批外页面源代码丢失。
        continueParams = {};
        for (const [key, value] of Object.entries(cont)) {
          if (key !== 'gapcontinue') {
            continueParams[key] = value;
          }
        }
      } while (continueParams.rvcontinue !== undefined || continueParams.clcontinue !== undefined);
      count += flushPages(pageMap);
      // 写入成功后保存断点，中断后可从此处续传
      if (nextGapcontinue) {
        saveProgress(namespace, nextGapcontinue);
      }
      if (count % LOG_INTERVAL < 500) {
        logger.info(`已获取${count}个页面`);
      }
      gapcontinue = nextGapcontinue;
    } while (gapcontinue);
    // 全量完成，清除该命名空间的断点
    clearProgress(namespace);
    logger.info(`命名空间${namespace}全量获取完毕，共${count}个页面`);
  };

  {
    const progress = loadProgress();
    const hasResume = Object.keys(progress).length > 0;
    if (hasResume) {
      logger.info('检测到未完成的全量获取，从断点继续');
    }
    if (hasResume || getPageCount() === 0) {
      for (const ns of TRACKED_NAMESPACES) {
        const resume = progress[String(ns)];
        // 续传模式下无断点的命名空间视为已完成，跳过避免重复拉取
        if (hasResume && resume === undefined) {
          logger.info(`命名空间${ns}已全量获取，跳过`);
          continue;
        }
        await fetchAllPagesContent(ns, resume);
      }
    } else {
      await syncIncremental({ api, logger });
    }
  }

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
      const response = await api.post({
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
      for (const page of response.query.pages as Array<{
        title: string;
        varianttitles?: Record<string, string>;
      }>) {
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
