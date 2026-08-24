import type { TaskHandler } from '../services/tasks/types';

/** 不视为多余后缀的标题前缀白名单 */
const WHITE_LIST = [
  'Bilibili Moe 2016 动画角色人气大赏',
  'Bilibili Moe 2017 动画角色人气大赏',
  'Bilibili Moe 2018 动画角色人气大赏',
  'L!L!L!',
  'L！L！L！',
  '碧蓝航线/图鉴/',
];

/** `allredirects` 返回的重定向数据 */
interface RedirectData {
  /** 重定向页面 */
  from: string;
  /** 目标页面 */
  to: string;
}

/**
 * 更新[[萌娘百科:疑似多余消歧义后缀]]
 *
 * 分析全站页面标题中的多余消歧义后缀，分为三类：
 * 1. “FOO(BAR)”存在，“FOO”不存在
 * 2. “FOO(BAR)”重定向到“FOO”
 * 3. “FOO”重定向到“FOO(BAR)”
 */
const suffix: TaskHandler = async ({ api, logger }) => {
  // 获取所有页面标题
  logger.info('开始获取所有页面列表');
  const allPages = await api.fetchAllPages();
  logger.info(`获取到${allPages.size}个页面`);

  // 分析出后缀存在、无后缀不存在的标题
  const absentList: string[] = [];
  for (const title of allPages) {
    if (
      title.slice(-1) === ')' &&
      title[0] !== '(' &&
      (!title.includes(':') || title.indexOf(':') > title.indexOf('('))
    ) {
      const titleWithoutSuffix = title.replace(/\(.*\)/, '').trim();
      if (
        !allPages.has(titleWithoutSuffix) &&
        !WHITE_LIST.some((item) => title.indexOf(item) === 0)
      ) {
        absentList.push(`* [[${title}]]→[[${titleWithoutSuffix}]]`);
      }
    }
  }
  logger.info(`获取到${absentList.length}个疑似多余的消歧义后缀页面`);

  // 获取全站重定向，分析后缀↔无后缀的对应关系
  const suffix2Origin: string[] = [];
  const origin2Suffix: string[] = [];
  let garcontinue: string | boolean = false;
  logger.info('开始获取重定向页面');
  do {
    const allRedirects = await api.post({
      action: 'query',
      generator: 'allredirects',
      redirects: true,
      garlimit: 'max',
      garnamespace: '0',
      garcontinue,
    });
    garcontinue = allRedirects.continue?.garcontinue || false;
    for (const item of (allRedirects.query.redirects as RedirectData[])) {
      // 后缀重定向至无后缀
      if (item.from.replace(/^(.*)\(.*\)$/, '$1') === item.to) {
        suffix2Origin.push(`* [{{canonicalurl:${item.from}|redirect=no}} ${item.from}]→[[${item.to}]]`);
      }
      // 无后缀重定向至后缀
      if (item.from === item.to.replace(/^(.*)\(.*\)$/, '$1')) {
        origin2Suffix.push(`* [{{canonicalurl:${item.from}|redirect=no}} ${item.from}]→[[${item.to}]]`);
      }
    }
  } while (garcontinue);
  logger.info(`获取到${suffix2Origin.length}个后缀重定向至无后缀，${origin2Suffix.length}个无后缀重定向至后缀`);

  // 编辑保存
  const pageName = '萌娘百科:疑似多余消歧义后缀';
  const text = [
    '本页面列举疑似多余的消歧义后缀，分为三类：',
    '# “FOO(BAR)”存在，“FOO”不存在；',
    '# “FOO(BAR)”重定向到“FOO”；',
    '# “FOO”重定向到“FOO(BAR)”。',
    '本页面由机器人每周自动更新，如需快速更新请[[User_talk:BearBin|联系BearBin]]。',
    '',
    '__TOC__<div class="plainlinks>',
    '',
    '== 后缀存在、无后缀不存在 ==',
    absentList.join('\n'),
    '',
    '== 有后缀重定向到无后缀 ==',
    '',
    suffix2Origin.join('\n'),
    '',
    '== 无后缀重定向到有后缀 ==',
    '',
    origin2Suffix.join('\n'),
    '</div>',
    '[[Category:萌娘百科数据报告]][[Category:积压工作]]',
  ].join('\n');

  await api.editPage(pageName, text, '自动更新列表');
};

export default suffix;
