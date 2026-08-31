import { MessOutput } from './output';

/** 检查函数签名：接收页面源代码、分类列表、标题，将检查结果写入 MessOutput */
type PageCheck = (text: string, categories: string[], title: string) => void;

/** 创建检查函数所需的上下文 */
interface CheckContext {
  /** 检查结果输出器 */
  messOutput: MessOutput;
  /** 页顶提示模板名称列表（来自 [[Category:页顶提示模板]]） */
  topTipTemplates: string[];
}

/**
 * 模板名称及其别名的正则匹配规则
 *
 * `prefix` 为通用前缀（匹配 `{{template:` / `{{模板:` / `{{T:` 等变体），
 * 其余字段为各分类模板的别名正则数组，用于 `templateIndex` 等函数构建完整匹配正则。
 */
const TEMPLATES = {
  prefix: '\\{\\{(?:template:|[模样樣]板:|T:)?',

  /** 导航条 */
  navbar: ['小[导導]航[条條]', '小[导導]航[条條]\\/承前[启啟][后後]'],
  /** 消歧义导航模板 */
  disambigTop: ['about', 'not', 'distinguish', 'dablink', 'redirectHere', 'otheruseslist'],
  /** 欢迎编辑及 TOP 模板 */
  top: ['[欢歡]迎[编編][辑輯]', '不完整', '急需改[进進]', '[^{|\\[\\]]+top'],
  /** T:消歧义 */
  disambig: ['消歧[义義]'],
  /** 提示模板 */
  note: ['[现現][实實]人物'],
  /** 警告模板 */
  warn: ['法律声明', '医学声明', '学术提示', '非官方猜测', '易引发谣言', '用梗适度', '谨慎使用'],
  /** 其他提示模板 */
  otherNote: ['已故现实人物', '已完结', '长期关注及更新', '含时长期关注及更新', '停止活动', '引退'],
  /** 娱乐页顶模板 */
  amuse: ['阿卡林', '被巡回', '黑幕可能无法划开', '暂时保留', '一本正经地胡说八道', '坑'],
  /** 喊话模板 */
  quote: ['cquote', '先一起喊'],
  /** 底部模板（用于检测大家族模板位置错误或单独二级标题时排除特定模板） */
  bottom: [
    'reflist', 'notelist', 'NoteFoot', 'notes', 'cite',
    '到萌娘文[库庫]', '到[维維]基百科', 'ToWikipedia', '到FANDOM', '到纳木维基',
    '到VNDB', 'To BWIKI', 'To 52poke Wiki', 'To Megami Tensei Wiki',
    '到灰[机機]wiki', '到泰拉瑞[亚亞]Wiki', '到泰拉瑞亚MODWiki', '到MC百科',
    '到Minecraft Wiki', '到魔禁[维維]基', '到THBWiki', '到BlitzHanger',
    '到女神[转轉]生[维維]基', '到MLP中文[维維]基', '到PvZ Wiki', '微博',
    'PAGENAME', 'DEFAULTSORT', '#if', '#switch',
    'lj\\|', 'color\\|', 'ruby\\|', 'hide\\|', '[剧劇]透', '黑幕', '胡话',
    'jk\\|', 'main\\|', 'ja\\}', 'en\\}', 'zh\\}', 'zh-hans', 'zh-hant', 'lang\\|',
    'cquote', 'Ps\\|',
    'catn', 'ColonSort', 'bilibiliVideo', 'BV', 'YoukuVideo', 'music163',
    '背景[图圖]片', '替[换換][侧側][边邊][栏欄]底[图圖]', '外部[图圖]片注[释釋]',
    '[标標][题題]替[换換]', 'PicHover', 'Outer[ _]image', 'pic\\|', 'disambig',
    'Playlist', '消歧义页', 'NoSubpage', 'noReferer', '用梗适度',
    '一本正经地胡说八道', 'color[ _]block', 'RoundTop', 'see also',
  ],
};

/**
 * 查找正则表达式在字符串中的所有匹配位置
 *
 * @param str 要查找的字符串
 * @param reg 带有 `g` 标志的正则表达式
 * @returns 匹配起始位置数组
 */
export function regexPosition(str: string, reg: RegExp): number[] {
  let match: RegExpExecArray | null;
  const indexes: number[] = [];
  while ((match = reg.exec(str)) !== null) {
    indexes.push(match.index);
  }
  return indexes;
}

/**
 * 查找指定模板在文本中的出现位置
 *
 * @param text 页面源代码
 * @param templates 模板别名正则数组
 * @returns 模板起始位置数组
 */
function templateIndex(text: string, ...templates: string[]): number[] {
  return regexPosition(text, new RegExp(`${TEMPLATES.prefix}(${templates.join('|')})[}\\|\\n]`, 'gi'));
}

/**
 * 检查多个位置组成的数组是否按顺序排列（前一组最大值 < 后一组最小值）
 *
 * 仅考虑前 600 字符内的模板位置（页顶区域）。
 *
 * @param arrays 各模板的位置数组列表
 * @returns 位置有误的模板索引（0 表示无误）
 */
export function checkOrder(arrays: number[][]): number {
  for (let i = 0; i < arrays.length - 1; i++) {
    const maxA = Math.max(...arrays[i].filter((num) => num <= 600));
    for (let j = i + 1; j < arrays.length; j++) {
      const minB = Math.min(...arrays[j].filter((num) => num <= 600));
      if (maxA >= minB) {
        return j;
      }
    }
  }
  return 0;
}

/** 冗余管道符检查（0和10共用） */
function redundantPipeShared(messOutput: MessOutput): PageCheck {
  return (text, _categories, title) => {
    const normal = text.match(/\[\[ *([^\]]+) *\| *\1 *\]\]/);
    const escape = text.match(/\| *([^\]{}}]+) *\{\{!\}\} *\1 *(\||\})/);
    if (normal) {
      messOutput.addPageToList('<nowiki>[[ABC|ABC]]</nowiki>', [title, `<code><nowiki>${normal[0]}</nowiki></code>`]);
    }
    if (escape) {
      messOutput.addPageToList('<nowiki>|ABC{{!}}ABC</nowiki>', [title, `<code><nowiki>${escape[0]}</nowiki></code>`]);
    }
  };
}

/** 弃用 HTML 标签及其匹配正则（center/tt/strike/font），带 g 标志的 match 不依赖 lastIndex，可安全复用 */
const DEPRECATED_TAGS = [
  { tag: 'center', regex: /<(center)(?:\s[^>]*)?>|<\/center>/gi },
  { tag: 'tt', regex: /<(tt)(?:\s[^>]*)?>|<\/tt>/gi },
  { tag: 'strike', regex: /<(strike)(?:\s[^>]*)?>|<\/strike>/gi },
  { tag: 'font', regex: /<(font)(?:\s[^>]*)?>|<\/font>/gi },
];

/** 弃用标签检查（0和10共用） */
function deprecatedTagsShared(messOutput: MessOutput): PageCheck {
  return (text, _categories, title) => {
    for (const { tag, regex } of DEPRECATED_TAGS) {
      const match = text.match(regex);
      if (match) {
        if (tag === 'font') {
          messOutput.addPageToList(tag, [title, `<code><nowiki>${match[0]}</nowiki></code>`]);
        } else {
          messOutput.addPageToList(tag, title);
        }
      }
    }
  };
}

/**
 * 创建主命名空间（ns=0）的检查函数列表
 *
 * @param ctx 检查上下文（包含 messOutput 和 topTipTemplates）
 * @returns 检查函数数组
 */
export function createMainChecks(ctx: CheckContext): PageCheck[] {
  const { messOutput, topTipTemplates: topTipTemplate } = ctx;

  /** 检查消歧义页内中的管道符 */
  const pipeInDisambig: PageCheck = (text, categories, title) => {
    if (categories.includes('Category:消歧义页')) {
      const prefix = text.match(/\[\[(.+)\(.+\)\|\1\]\].*—/);
      const suffix = text.match(/\[\[[^:\n].*:(.+)\|\1\]\].*—/);
      if (prefix) {
        messOutput.addPageToList('后缀', [title, `<code><nowiki>${prefix[0].replaceAll('—', '')}</nowiki></code>`]);
      } else if (suffix) {
        messOutput.addPageToList('前缀', [title, `<code><nowiki>${suffix[0].replaceAll('—', '')}</nowiki></code>`]);
      }
    }
  };

  /** 在页面中查找重复出现的大量换行 */
  const wrapDetector: PageCheck = (text, categories, title) => {
    if (categories.some((category) => category.includes('音乐作品'))) {
      return;
    }
    if (/(<br *\/ *>\s*){4,}/i.test(text) || /(\n|<br *\/? *>){8}/i.test(text)) {
      messOutput.addPageToList('连续换行', title);
    }
  };

  /** 检测连续出现的 big 标签 */
  const bigDetector: PageCheck = (text, _categories, title) => {
    if (/(<big>){5}/i.test(text)) {
      messOutput.addPageToList('big地狱（5个以上）', title);
    }
  };

  /** 能用内链非要用外链 */
  const innerToOuter: PageCheck = (text, _categories, title) => {
    if (new RegExp(`${TEMPLATES.prefix}(背景[图圖]片|替[换換][侧側][边邊][栏欄]底[图圖])[^}]+img\\.moegirl\\.org\\.cn`, 'si').test(text) && title !== 'Deltarune/黑暗世界') {
      messOutput.addPageToList('能用内链非要外链', title);
    }
  };

  /** 检查大家族前疑似单独使用二级标题的页面 */
  const headlineBeforeNav: PageCheck = (text, _categories, title) => {
    if (new RegExp(`== *(相关|更多|其他|其它)(条目|條目|内容|链接)? *==\n*${TEMPLATES.prefix}((?!${TEMPLATES.bottom.join('|')}).)*\\}`, 'gi').test(text)) {
      messOutput.addPageToList('疑似大家族前单独用二级标题', title);
    }
  };

  /** 位于注释或外部链接之后的大家族模板 */
  const refBeforeNav: PageCheck = (text, _categories, title) => {
    if (new RegExp(`== *(脚注|[注註]解|注释|註釋|外部[链鏈]接|外部連結|外链|[参參]考).*==[\\s\\S]*\n${TEMPLATES.prefix}((?!${TEMPLATES.bottom.join('|')}).)*\\}`, 'gi').test(text)) {
      messOutput.addPageToList('注释和外部链接后的大家族模板', title);
    }
  };

  /** 检查疑似喊话内容 */
  const redBoldText: PageCheck = (text, _categories, title) => {
    if (
      /\{\{color\|red\|'''[^}|]{50,}'''\}\}/i.test(text) ||
      /'''\{\{color\|red\|[^}|]{50,}\}\}'''/i.test(text)
    ) {
      messOutput.addPageToList('疑似喊话', title);
    }
  };

  /** 检查重复 TOP */
  const repetitiveTop: PageCheck = (text, _categories, title) => {
    const topPattern = new RegExp(`${TEMPLATES.prefix}(${TEMPLATES.top.join('|')})[}\\|\\n]`, 'gi');
    const useTemplates = text.match(topPattern) || [];
    let usedTops = 0;
    for (const item of useTemplates) {
      if (topTipTemplate.includes(item.replace(topPattern, '$1'))) {
        usedTops++;
      }
    }
    if (usedTops > 1) {
      messOutput.addPageToList('重复TOP', title);
    }
  };

  /** 检查用图超过 99px 的页顶模板（条目） */
  const imgLT99px: PageCheck = (text, _categories, title) => {
    if (
      /leftimage *=[.\n]*\d{3}px/.test(text) ||
      /\{\{(?:template:|[模样樣]板:|T:)?(欢迎编辑|歡迎編輯|不完整|customtop).*\d{3}px/i.test(text)
    ) {
      messOutput.addPageToList('条目', title);
    }
  };

  /** 检查页顶模板排序 */
  const templateOrder: PageCheck = (text, _categories, title) => {
    const templateIndexes = {
      消歧义导航模板: templateIndex(text, ...TEMPLATES.disambigTop),
      专题导航导航: templateIndex(text, '导航'),
      导航条: templateIndex(text, ...TEMPLATES.navbar),
      '{{tl|消歧义}}': templateIndex(text, ...TEMPLATES.disambig),
      欢迎编辑或专题TOP: templateIndex(text, ...TEMPLATES.top),
      提示模板: templateIndex(text, ...TEMPLATES.note),
      娱乐模板: templateIndex(text, ...TEMPLATES.amuse),
      喊话模板: templateIndex(text, ...TEMPLATES.quote),
    };
    const wrongTemplate = checkOrder(Object.values(templateIndexes));
    if (wrongTemplate > 0) {
      messOutput.addPageToList('顶部模板排序', [title, `<code>${Object.keys(templateIndexes)[wrongTemplate]}</code>`]);
    }
  };

  /** 检查多个生日分类 */
  const duplicateBirthday: PageCheck = (_text, categories, title) => {
    const birthdayCategories = [...new Set(categories)].filter((category: string) => /\d+月\d+日/.test(category));
    if (birthdayCategories.length > 1) {
      messOutput.addPageToList('多个生日分类', [title, birthdayCategories.map((cat) => cat.replace('Category:', '')).join('、')]);
    }
  };

  /** 检查紧邻汉字或平假名，且附近没有其他片假名的"ヘ"或"リ" */
  const isolatedKatakana: PageCheck = (text, _categories, title) => {
    if (text.length < 100) {
      return;
    }
    const regex = /(?<=[\p{Script=Han}\p{Script=Hiragana}])[ヘリ]|[ヘリ](?=[\p{Script=Han}\p{Script=Hiragana}])/gu;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const pos = match.index;
      const windowSize = 15;
      const start = Math.max(0, pos - windowSize);
      const end = Math.min(text.length, pos + match[0].length + windowSize);
      const fragment = text.substring(start, end);
      const katakanaInFragment = fragment.match(/[\u30A0-\u30FF]/g);
      if (katakanaInFragment && katakanaInFragment.length === 1) {
        const context = fragment.replace(/\n/g, ' ');
        messOutput.addPageToList('单独出现的ヘ和リ', [title, `<code><nowiki>${context}</nowiki></code>`]);
        break;
      }
    }
  };

  /** 可能需要补充"配音角色" */
  const oldCVCategory: PageCheck = (text, _categories, title) => {
    const match = text.match(/\|多位(配音|声优) *= *\{\{cate\|[^{}|]+\|[^{}[\]\n]+[^色{}[\]\n](\}\}|\|)/gi);
    if (match) {
      messOutput.addPageToList('旧声优分类格式', [title, `<code><nowiki>${match[0]}</nowiki></code>`]);
    }
  };

  /** 检查 http(s) 少冒号或斜杠 */
  const httpColon: PageCheck = (text, _categories, title) => {
    const http = text.match(/[^/]https?(\/\/|:\/[a-zA-Z0-9])/gi);
    if (http) {
      messOutput.addPageToList('http(s)少冒号或斜杠', [title, `<code><nowiki>${http[0]}</nowiki></code>`]);
    }
  };

  return [
    pipeInDisambig, wrapDetector, bigDetector, repetitiveTop, imgLT99px,
    redBoldText, headlineBeforeNav, refBeforeNav, templateOrder, innerToOuter,
    redundantPipeShared(messOutput), oldCVCategory, httpColon, deprecatedTagsShared(messOutput),
    duplicateBirthday, isolatedKatakana,
  ];
}

/**
 * 创建模板命名空间（ns=10）的检查函数列表
 *
 * @param ctx 检查上下文（包含 messOutput）
 * @returns 检查函数数组
 */
export function createTemplateChecks(ctx: CheckContext): PageCheck[] {
  const { messOutput } = ctx;

  /** 检查用图超过 99px 的页顶模板（模板空间） */
  const imgLT99pxInTemplate: PageCheck = (text, categories, title) => {
    if (categories.includes('Category:页顶提示模板') && (
      /leftimage *=.*\d{3}px/.test(text) ||
      /(width|size) *= *\d{3}px/.test(text) ||
      /\[\[(File|Image):[^\]]+\| *\d{3}px/i.test(text)
    )) {
      messOutput.addPageToList('模板', title);
    }
  };

  /** 检查模板中的多余换行 */
  const redundantWrapInTemplate: PageCheck = (text, categories, title) => {
    if (categories.some((category) => ['Category:模板文档', 'Category:条目格式模板', 'Category:权限申请模板'].includes(category))) {
      return;
    }
    if (/(\n{2,}<noinclude>|<\/noinclude>\n{2,}[^|]|<includeonly>\n{2,}|\n{2,}<\/includeonly>)/.test(text)) {
      messOutput.addPageToList('两个或以上', title);
    } else if (/(\n<noinclude>|<\/noinclude>\n|<includeonly>\n|\n<\/includeonly>)/.test(text)) {
      messOutput.addPageToList('一个', title);
    }
  };

  /** "•"左右缺少空格 */
  const needSpaceBesidesPoint: PageCheck = (text, categories, title) => {
    if (categories.includes('Category:用户编辑组模板')) {
      return;
    }
    const left = text.match(/([^\]\n]+\]\]|[^}\n]+\}\})•/);
    const right = text.match(/•(\[\[[^\]\n]+|\{\{[^}\n]+)/);
    if (left) {
      messOutput.addPageToList('左侧缺少', [title, `<code><nowiki>${left[0]}</nowiki></code>`]);
    }
    if (right) {
      messOutput.addPageToList('右侧缺少', [title, `<code><nowiki>${right[0]}</nowiki></code>`]);
    }
  };

  /** navbox 中的错误 name 参数 */
  const wrongNavName: PageCheck = (text, categories, title) => {
    const nameParam = text.match(/\| *name *= *[^|\n]*/gi) || [];
    if (
      categories.includes('Category:模板文档') ||
      !text.match(/\{\{ *(?:#invoke:|Template:|T:|模板:|样板:)? *(大家族|Nav)/gi) ||
      /:(沙盒|Sandbox|Navbox|大家族$)/.test(title)
    ) {
      return;
    }
    for (const match of nameParam) {
      if (match.replace(/\| *name *= *([^|\n]*)/g, '$1').replaceAll('_', ' ').trim().toLowerCase() !== title.replace('Template:', '').toLowerCase()) {
        messOutput.addPageToList('大家族name参数有误', [title, `<code><nowiki>${match}</nowiki></code>`]);
        return;
      }
    }
  };

  return [
    imgLT99pxInTemplate, redundantWrapInTemplate, needSpaceBesidesPoint,
    redundantPipeShared(messOutput), wrongNavName, deprecatedTagsShared(messOutput),
  ];
}
