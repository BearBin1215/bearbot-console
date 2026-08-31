import type { TaskHandler } from '../services/tasks/types';
import type { TitleEntry } from '../services/moegirl';

interface PageEntry {
  title: string;
  ns?: number;
  redirects?: TitleEntry[];
  links?: TitleEntry[];
}

/**
 * 更新[[萌娘百科:链接到消歧义页面的导航模板]]
 *
 * 列出[[:Category:导航模板|导航模板]]中链接到消歧义页面的链接
 */
const disambigLinkInNav: TaskHandler = async ({ api, logger, sleep, params }) => {
  /** 递归请求间的等待时间（ms），可通过任务参数 interval 配置 */
  const rawInterval = Number(params.interval);
  const requestInterval = Number.isFinite(rawInterval) ? rawInterval : 500;

  // #region 获取消歧义页列表

  /** 获取所有消歧义页标题及其重定向 */
  const getAllDisambigs = async () => {
    const disambigs = new Set<string>();
    let gcmcontinue: string | false = false;
    logger.info('开始获取消歧义页列表……');
    do {
      const catMembers = await api.post({
        action: 'query',
        generator: 'categorymembers',
        prop: 'redirects',
        gcmlimit: 'max',
        rdlimit: 'max',
        gcmtitle: 'Category:消歧义页',
        gcmcontinue,
      });
      gcmcontinue = catMembers.continue?.gcmcontinue || false;
      for (const item of (catMembers.query.pages as PageEntry[])) {
        disambigs.add(item.title);
        for (const rd of item.redirects || []) {
          disambigs.add(rd.title);
        }
      }
    } while (gcmcontinue);
    logger.info(`获取到${disambigs.size}个消歧义页及其重定向`);
    return disambigs;
  };

  const disambigSet = await getAllDisambigs();

  // #endregion


  // #region 递归遍历导航模板分类

  /** 记录已经查询过的分类，避免分类嵌套导致无限循环 */
  const traversedCategories = new Set<string>();
  /** 已完整收集的模板标题（跨分类去重） */
  const collectedTemplates = new Set<string>();
  /** 模板页中的链接集 */
  const linksInTemplates: Record<string, string[]> = {};
  /** 下一个进度日志输出的模板数量阈值（每 1000 个输出一次） */
  let nextMilestone = 1000;

  /**
   * 递归获取分类下所有模板页面及其链接
   *
   * 用 `generator=categorymembers` + `prop=links` 合并请求，边遍历分类边获取链接，
   * 分页时直接回传响应中的 `continue` 对象（可能含 `plcontinue` 和/或 `gcmcontinue`），
   * 直至当前分类的成员与链接全部获取完毕，再递归其子分类。
   *
   * 去重策略：
   * - `collectingInThisCategory`：本分类内正在收集的模板，用于链接分页时累加剩余链接
   * - `collectedTemplates`：跨分类去重，已在其他分类完整收集的模板不再重复记录
   *
   * @param category 待处理的分类标题
   */
  const fetchCategory = async (category: string): Promise<void> => {
    if (traversedCategories.has(category)) {
      return;
    }
    traversedCategories.add(category);
    const collectingInThisCategory = new Set<string>();
    const subcats: string[] = [];
    const baseParams = {
      action: 'query',
      prop: 'links',
      generator: 'categorymembers',
      plnamespace: 0,
      pllimit: 'max',
      gcmlimit: 'max',
      gcmtitle: category,
      gcmprop: 'title',
      gcmnamespace: '10|14',
      gcmtype: 'page|subcat',
    };
    let continueParams: Record<string, unknown> = {};
    do {
      const response = await api.post({ ...baseParams, ...continueParams });
      for (const page of (response.query?.pages as PageEntry[] | undefined) ?? []) {
        if (page.ns === 14) {
          subcats.push(page.title);
        } else {
          const { title } = page;
          const pageLinks = (page.links || []).map((l) => l.title);
          if (collectingInThisCategory.has(title)) {
            // 本分类内正在收集：累加链接分页的剩余链接
            linksInTemplates[title].push(...pageLinks);
          } else if (!collectedTemplates.has(title)) {
            // 首次出现（未在其他分类收集过）：开始收集
            collectedTemplates.add(title);
            collectingInThisCategory.add(title);
            linksInTemplates[title] = [...pageLinks];
            // 每收集 1000 个模板输出一次进度
            while (collectedTemplates.size >= nextMilestone) {
              logger.info(`已检查${nextMilestone}个模板`);
              nextMilestone += 1000;
            }
          }
          // else：跨分类重复，已在其他分类完整收集，跳过（本分类内的后续分页同样跳过，避免重复累加）
        }
      }
      continueParams = response.continue || {};
      // 分页间短暂等待，避免请求过于密集
      if (Object.keys(continueParams).length > 0) {
        await sleep(requestInterval);
      }
    } while (Object.keys(continueParams).length > 0);
    // 递归子分类（去重）
    for (const subcat of [...new Set(subcats)]) {
      await fetchCategory(subcat);
    }
  };

  logger.info('开始获取导航模板及其链接……');
  await fetchCategory('Category:导航模板');
  logger.info(`获取到${collectedTemplates.size}个模板，正在筛选其中的消歧义链接……`);

  // #endregion


  // #region 筛选模板中的消歧义链接并保存

  // 筛选模板内的消歧义链接
  const disambigInTemplates: Record<string, string[]> = {};
  for (const [key, pages] of Object.entries(linksInTemplates)) {
    const filteredPages = pages.filter((page) => disambigSet.has(page));
    if (filteredPages.length > 0) {
      disambigInTemplates[key] = (disambigInTemplates[key] || []).concat(filteredPages);
    }
  }
  logger.info(`筛选出${Object.keys(disambigInTemplates).length}个含消歧义链接的模板`);

  // 生成 wikitext 并保存
  const targetPageName = '萌娘百科:链接到消歧义页面的导航模板';
  const text = [
    '本页面列出[[:Category:导航模板|导航模板]]中的消歧义链接。',
    '',
    '部分链接可能本意就是链接到消歧义页面，请注意甄别。',
    '',
    '由机器人自动更新，其他时间如需更新请[[User_talk:BearBin|联系BearBin]]。',
    '----',
    Object.entries(disambigInTemplates)
      .map(([key, values]) => `;[[${key}]]<span class="plainlinks" style="font-weight:normal">【[{{fullurl:${key}|action=edit}} 编辑]】</span>\n:[[${values.join(']]\n:[[')}]]\n`)
      .join(''),
    '[[Category:萌娘百科数据报告]]',
  ].join('\n');

  await api.editPage(targetPageName, text, '自动更新列表');
  // #endregion
};

export default disambigLinkInNav;
