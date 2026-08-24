/**
 * 杂物检查结果的数据结构
 *
 * 键为标题（headline），值为页面列表数组或嵌套的 PageData。
 * 页面列表中的元素可以是字符串（页面名）或 `[页面名, 附加信息]` 元组。
 */
export interface PageData {
  [key: string]: (string | [string, string])[] | PageData;
}

/**
 * 杂物检查结果输出器
 *
 * 维护一棵嵌套的分类树，支持按标题查找并插入页面，
 * 最终递归遍历生成 wikitext 格式的报告页面。
 */
export class MessOutput {
  /** 分类树根节点 */
  data: PageData;

  /**
   * @param data 初始化的分类树结构（包含所有预定义标题）
   */
  constructor(data: PageData) {
    this.data = data;
  }

  /**
   * 广度优先遍历分类树，找到与 headline 匹配的节点并插入页面
   *
   * 若未找到匹配标题，在根节点下新建一个数组。
   *
   * @param headline 要查找的标题
   * @param page 页面名或 `[页面名, 附加信息]` 元组
   */
  addPageToList(headline: string, page: string | [string, string]): void {
    const queue: object[] = [this.data];
    while (queue.length > 0) {
      const obj = queue.shift()!;
      for (const [key, val] of Object.entries(obj)) {
        if (key === headline) {
          if (Array.isArray(val)) {
            val.push(page);
            return;
          }
          return;
        }
        if (typeof val === 'object' && val !== null) {
          queue.push(val);
        }
      }
    }
    this.data[headline] = [page];
  }

  /** 递归遍历分类树，生成完整的 wikitext */
  get wikitext(): string {
    let listLevel = 1;
    const textList = [
      '本页面由机器人自动更新，因此通常不建议直接编辑本页面。',
      '',
      '最后更新时间：<u>~~~~~</u>，因完整爬取需要时间，存在误差。',
      '',
      '大多数内容建议手动排查，以免误判。',
      '',
      '一些常见误判诸如在非页顶使用{{tl|dablink}}等情况。若出现其他误判，请[[User_talk:BearBin|联系阿熊]]。',
    ];

    /**
     * 递归遍历分类树，将标题和列表写入 textList
     * @param obj 当前层级的分类树节点
     */
    const addListToTextList = (obj: PageData): void => {
      listLevel++;
      for (const [headline, pages] of Object.entries(obj)) {
        // 标题
        textList.push('', `${'='.repeat(listLevel)} ${headline} ${'='.repeat(listLevel)}`);
        // 列表
        if (Array.isArray(pages)) {
          if (pages.length > 0) {
            textList.push(
              '{{hide|1=点击展开列表|2=',
              ...pages.map((page) => {
                if (typeof page === 'string') {
                  return `*[[${page}]]`;
                }
                return `*-{[[${page[0]}]]}-：${page[1]}`;
              }),
              '}}',
            );
          } else {
            textList.push('暂无');
          }
        } else if (typeof pages === 'object' && pages !== null) {
          addListToTextList(pages);
        } else {
          throw new Error(`${headline}对应值类型有误: ${typeof pages}`);
        }
      }
      listLevel--;
    };
    addListToTextList(this.data);
    return textList.join('\n');
  }
}

/** 初始化分类树结构（包含所有预定义的检查结果标题） */
export const MESS_DATA: PageData = {
  消歧义页使用管道符: {
    后缀: [],
    前缀: [],
  },
  疑似繁体页面名: [],
  不礼貌排版习惯: {
    连续换行: [],
    'big地狱（5个以上）': [],
    疑似大家族前单独用二级标题: [],
    疑似喊话: [],
  },
  弃用标签: {
    center: [],
    strike: [],
    tt: [],
    font: [],
  },
  能用内链非要外链: [],
  不符合模板规范: {
    重复TOP: [],
    页顶用图超过99px: {
      条目: [],
      模板: [],
    },
    顶部模板排序: [],
    注释和外部链接后的大家族模板: [],
  },
  大家族name参数有误: [],
  模板多余换行: {
    两个或以上: [],
    一个: [],
  },
  '•左右少空格': {
    左侧缺少: [],
    右侧缺少: [],
  },
  '管道符前后一致（无明显影响，通常不用专门处理）': {
    '<nowiki>[[ABC|ABC]]</nowiki>': [],
    '<nowiki>|ABC{{!}}ABC</nowiki>': [],
  },
  旧声优分类格式: [],
  'http(s)少冒号或斜杠': [],
  多个生日分类: [],
  单独出现的ヘ和リ: [],
};
