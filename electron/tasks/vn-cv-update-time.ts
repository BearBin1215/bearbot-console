import { chunk } from 'es-toolkit';
import type { TaskHandler } from '../services/tasks/types';

/** 统计目标页面 */
const TARGET_PAGE = 'User:BearBin/VNData/里界声优条目更新时间';
/** 统计来源分类 */
const CATEGORY = 'Category:R-18作品配音演员';
/** R-18作品声优索引模板，用于解析引退声优 */
const INDEX_TEMPLATE = 'Template:R-18作品声优索引';

/** 单个条目的最后更新信息 */
interface CvLastUpdate {
  /** 条目标题 */
  title: string;
  /** 最后修订时间戳（ISO 8601，UTC） */
  timestamp: string;
}

/** 将页面标题规范化为 MediaWiki 标准格式（首字母大写、下划线转空格），用于标题匹配 */
function normalizeTitle(title: string): string {
  return (title.charAt(0).toUpperCase() + title.slice(1)).replaceAll('_', ' ');
}

/**
 * 从 R-18作品声优索引模板源代码中解析引退声优（引退者以 skewX 斜体样式标记）
 * @param source 模板源代码
 * @returns 引退声优的条目标题集合（规范化后）
 */
function parseRetiredCVs(source: string): Set<string> {
  const retiredCVs = new Set<string>();
  const spanPattern = /<span[^>]*transform:\s*skewX\(-10deg\)[^>]*>([\s\S]*?)<\/span>/g;
  for (const [, content] of source.matchAll(spanPattern)) {
    for (const [, target] of content.matchAll(/\[\[([^\]|#]+)/g)) {
      retiredCVs.add(normalizeTitle(target.trim()));
    }
  }
  return retiredCVs;
}

/**
 * 将 ISO 8601 时间戳格式化为 YYYY-MM-DD HH:mm:ss（本地时区）
 * @param timestamp ISO 8601 时间戳
 * @returns 格式化后的时间字符串
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const datePart = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const timePart = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  return `${datePart} ${timePart}`;
}

/**
 * 更新[[User:BearBin/VNData/里界声优条目更新时间]]
 *
 * 获取[[:Category:R-18作品配音演员]]分类成员的最后修订时间，按时间升序生成列表写入统计页面，
 * 提示可能需要更新的页面；引退声优（依据 R-18作品声优索引模板中的斜体标记解析）用斜体表示。
 */
const vnCvUpdateTime: TaskHandler = async ({ api, logger, user }) => {
  /**
   * 获取引退声优索引模板源代码
   *
   * 模板不存在或获取失败时容错为空文本，引退声优将不作斜体标记，不影响任务继续执行
   * @returns 模板源代码（失败时为空字符串）
   */
  const fetchIndexTemplateSource = async (): Promise<string> => {
    try {
      return await api.getPageSource(INDEX_TEMPLATE);
    } catch {
      logger.warn(`获取${INDEX_TEMPLATE}源代码失败，引退声优将不作斜体标记`);
      return '';
    }
  };

  // 并行获取分类成员与引退声优索引模板源代码
  const [categoryMembers, templateSource] = await Promise.all([
    api.fetchCategoryMembers(CATEGORY, { cmprop: 'title' }),
    fetchIndexTemplateSource(),
  ]);
  const cvList = categoryMembers.map((member) => member.title);
  const retiredCVs = parseRetiredCVs(templateSource);
  logger.info(`获取到${cvList.length}个分类成员、${retiredCVs.size}名引退声优`);

  // 分批查询各条目最后修订时间
  const batchSize = (await user.getRights()).includes('apihighlimits') ? 500 : 50;
  const lastUpdateData: CvLastUpdate[] = [];
  for (const titleChunk of chunk(cvList, batchSize)) {
    const response = await api.post({
      action: 'query',
      prop: 'revisions',
      titles: titleChunk,
      rvprop: 'timestamp',
    });
    for (const page of response.query.pages as Array<{ title: string; revisions?: Array<{ timestamp: string }> }>) {
      const timestamp = page.revisions?.[0]?.timestamp;
      if (timestamp) {
        lastUpdateData.push({ title: page.title, timestamp });
      }
    }
  }
  logger.info(`获取到${lastUpdateData.length}个条目的最后更新时间`);

  // 按最后更新时间升序排列，最久未更新的条目排在前面；引退声优条目用斜体标记
  lastUpdateData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const listText = lastUpdateData
    .map(({ title, timestamp }) => {
      const item = `[[${title}]]：${formatTimestamp(timestamp)}`;
      return retiredCVs.has(normalizeTitle(title)) ? `* ''${item}''` : `* ${item}`;
    })
    .join('\n');

  // 生成 wikitext 并保存
  const text = [
    '{{用户 允许他人编辑|[[Template:萌百视觉小说研究会|视研会]]成员}}',
    '本页面统计[[:Category:R-18作品声优]]内页面的最后更新时间，提示可能需要更新的页面。\n',
    '您可以使用[[User:BearBin/VNData#VNTools|VNTools]]更新本页面。\n',
    "引退声优使用''斜体''表示。\n",
    `本页面最后一次由{{User|${user.getUser()}}}更新于~~~~~。\n`,
    listText,
  ].join('\n');

  await api.editPage(TARGET_PAGE, text, '自动更新列表');
};

export default vnCvUpdateTime;
