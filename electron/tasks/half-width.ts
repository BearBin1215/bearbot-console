import type { TaskHandler } from '../services/tasks/types';

/**
 * 更新[[User:BearBin/可能需要改为全角标点标题的页面]]
 *
 * 检查全站页面标题中，汉字/假名后紧跟半角 !?, 的标题，
 * 排除白名单（[[/排除页面]] 子页面）和 BanG Dream! 系列后保存到列表页。
 */
const halfWidth: TaskHandler = async ({ api, logger, signal }) => {
  // 获取所有页面标题
  logger.info('开始获取所有页面列表');
  const allPages = await api.fetchAllPages();
  logger.info(`获取到${allPages.size}个页面`);

  // 获取白名单页面源代码
  logger.info('正在获取白名单……');
  const source = await api.getPageSource('User:BearBin/可能需要改为全角标点标题的页面/排除页面');
  const whiteList = source
    .replaceAll('{{用户 允许他人编辑}}', '')
    .replaceAll(/\* *\[\[(.+)\]\]/g, '$1')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item);
  logger.info(`从白名单中获取到${whiteList.length}个页面`);

  // 筛选需要改为全角标点的标题
  const badList = [...allPages].filter((page) => {
    signal.throwIfAborted();
    return (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][!?,]/gu.test(page) &&
      !page.includes('BanG Dream!') &&
      !whiteList.includes(page)
    );
  });
  logger.info(`筛选出${badList.length}个可能需要改为全角标点的标题`);

  // 生成 wikitext 并保存
  const pageName = 'User:BearBin/可能需要改为全角标点标题的页面';
  const text = `{{info|列表中部分属于"原文如此"，请注意判别。如有此类页面，欢迎前往[[/排除页面]]添加。}}-{\n* [[${badList.join(']]\n* [[')}]]\n}-`;

  await api.editPage(pageName, text, '自动更新列表');
};

export default halfWidth;
