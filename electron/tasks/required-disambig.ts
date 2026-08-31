import type { TaskHandler } from '../services/tasks/types';
import type { TitleEntry } from '../services/moegirl';

interface PageWithRedirects {
  title: string;
  redirects?: TitleEntry[];
}

/** 专题内互相消歧义：全组条目均包含同一关键词时排除 */
const INTRA_TOPIC_KEYWORDS = [
  '美少女花骑士:', '碧蓝航线:', '碧蓝航线/', '工作细胞:', '假面骑士',
  '舰队Collection:', '舰队Collection/', '偶像大师', 'START:DASH!!',
  '魂器学院:', '黑塔利亚:', '我的魔塔:', '喜羊羊与灰太狼',
  '植物大战僵尸', '狗肉(辐射', '极品飞车:最高通缉', '白猫Project:',
  'Aqours CHRONICLE (',
];

/** 专题内消歧义前缀（全组条目均匹配同一前缀时排除） */
const INTRA_TOPIC_PREFIXES = [
  /^东方/,
  /^Bilibili Moe \d{4} 动画角色人气大赏/,
];

/** 阴阳师系列关键词（全组条目均含其中任一即视为同系列排除） */
const YYS_KEYWORDS = ['决战平安京', '百闻牌', '阴阳师手游', '妖怪屋'];

/** 角色消歧义：全组条目均包含同一角色名时排除 */
const CHARACTER_DISAMBIG_NAMES = ['木之本樱', '爱蜜莉雅'];

/** 其他排除关键词：全组条目均包含时排除 */
const OTHER_EXCLUDE_KEYWORDS = ['中国'];

/**
 * 判断两条目是否互为单曲/专辑变体（去掉后缀后标题相同）
 *
 * 如「歌名(单曲)」与「歌名(专辑)」视为同一组，无需创建消歧义页
 */
function isSingleVsAlbumPair(items: string[]): boolean {
  return items.length === 2 &&
    items[0].replace(/\((单曲|专辑|音乐专辑)\)/, '') ===
    items[1].replace(/\((单曲|专辑|音乐专辑)\)/, '');
}

/**
 * 更新[[User:BearBin/可能需要创建的消歧义页面]]
 *
 * 分析全站页面标题，找出可能需要创建消歧义页面的标题组：
 * 去掉前缀/后缀后相同标题的页面组，且不满足已有消歧义页、专题内消歧、角色消歧等排除条件。
 */
const requiredDisambig: TaskHandler = async ({ api, logger }) => {
  // 获取所有消歧义页标题及其重定向，去掉 (消歧义页) 后缀以免误判
  const disambigList = new Set<string>();
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
    for (const item of (catMembers.query.pages as PageWithRedirects[])) {
      disambigList.add(item.title.replace('(消歧义页)', ''));
      for (const rd of item.redirects || []) {
        disambigList.add(rd.title);
      }
    }
  } while (gcmcontinue);
  logger.info(`获取到${disambigList.size}个消歧义页及其重定向。开始获取条目列表。`);

  // 获取所有条目标题（排除重定向）
  const allPages = await api.fetchAllPages({ apfilterredir: 'nonredirects' });
  logger.info(`获取到${allPages.size}个页面`);

  // 按去掉前缀/后缀后的标题分组
  const requiredDisambigMap: Record<string, string[]> = {};
  for (const item of allPages) {
    // 去掉时间（含可选 AM/PM 后缀），去掉后无有效内容（纯时间标题）则保留原标题，
    // 再去掉命名空间前缀/消歧义后缀，提取核心标题用于分组
    // $1=命名空间前缀（可选，如 帮助:） $2=核心标题 $3=消歧义后缀（可选，如 (动画)）
    let titleWithoutFix = item.replace(/\d{1,2}:\d{2}(\s*[APap][Mm])?/, '');
    if (!titleWithoutFix.trim()) {
      titleWithoutFix = item;
    }
    titleWithoutFix = titleWithoutFix.replace(/^([^(]+:)?([^:)]+)(\(.+\))?$/, '$2');
    if (
      !disambigList.has(titleWithoutFix) && // 去掉前缀的页面不是消歧义页
      !item.includes('闪耀幻想曲:')
    ) {
      requiredDisambigMap[titleWithoutFix] ||= [];
      requiredDisambigMap[titleWithoutFix].push(item);
    }
  }

  // 过滤分组：条目数 > 1，且不满足专题内消歧义、角色消歧义等排除条件
  const textList = Object.entries(requiredDisambigMap)
    .filter(([_key, value]) => {
      if (value.length <= 1) {
        return false;
      }
      if (isSingleVsAlbumPair(value)) {
        return false;
      }
      if (INTRA_TOPIC_PREFIXES.some((p) => value.every((item) => p.test(item)))) {
        return false;
      }
      if (INTRA_TOPIC_KEYWORDS.some((kw) => value.every((item) => item.includes(kw)))) {
        return false;
      }
      // 阴阳师系列：全组条目均含任一关键词即视为同系列
      if (value.every((item) => YYS_KEYWORDS.some((kw) => item.includes(kw)))) {
        return false;
      }
      if (CHARACTER_DISAMBIG_NAMES.some((name) => value.every((item) => item.includes(name)))) {
        return false;
      }
      if (OTHER_EXCLUDE_KEYWORDS.some((kw) => value.every((item) => item.includes(kw)))) {
        return false;
      }
      return true;
    })
    .map(([key, value]) => `;[[${key}]]\n: [[${value.join(']]\n: [[')}]]`);
  logger.info(`筛选出${textList.length}组可能需要创建的消歧义页面`);

  // 生成 wikitext 并保存
  const pageName = 'User:BearBin/可能需要创建的消歧义页面';
  const text = [
    '{{info',
    '|leftimage=[[File:Nuvola_apps_important_blue.svg|50px|link=萌娘百科:消歧义方针]]',
    '|仅供参考、慎重处理，别真一个个无脑建过去了。',
    '}}',
    textList.join('\n'),
  ].join('\n');

  await api.editPage(pageName, text, '自动更新列表');
};

export default requiredDisambig;
