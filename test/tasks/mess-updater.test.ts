import { describe, it, expect, vi } from 'vitest';

// index.ts 依赖 page-store（node:sqlite + electron），测试纯函数时需 mock 以避免导入失败
vi.mock('../../electron/tasks/mess-updater/page-store', () => ({
  deletePages: vi.fn(),
  getPageCount: vi.fn(),
  getPageRevids: vi.fn(),
  iteratePages: vi.fn(),
  upsertPages: vi.fn(),
}));

import { fetchPagesWithDeniedIsolation, mergePages, reconcileRevids, type ApiResponsePage } from '../../electron/tasks/mess-updater/index';
import { MessOutput, type PageData } from '../../electron/tasks/mess-updater/output';
import { checkOrder, createMainChecks, regexPosition } from '../../electron/tasks/mess-updater/checks';
import type { PageRecord } from '../../electron/tasks/mess-updater/page-store';
import type { MoegirlApi } from '../../electron/services/moegirl';


// 测试 mergePages 函数（将 API 响应中的页面合并到 Map，处理续传响应的重复页面）
describe('mergePages', () => {
  // #region 新页面入库

  it('新页面 -> 写入 Map', () => {
    const pageMap = new Map<string, PageRecord>();
    const pages: ApiResponsePage[] = [{
      title: '沙盒',
      pageid: 123,
      ns: 0,
      revisions: [{ revid: 100, slots: { main: { content: '页面内容' } } }],
      categories: [{ title: 'Category:沙盒' }],
    }];
    mergePages(pageMap, pages);
    expect(pageMap.get('沙盒')).toEqual({
      title: '沙盒',
      pageid: 123,
      ns: 0,
      revid: 100,
      text: '页面内容',
      categories: ['Category:沙盒'],
    });
  });

  it('missing 为 true 的不存在页面 -> 跳过', () => {
    const pageMap = new Map<string, PageRecord>();
    const pages: ApiResponsePage[] = [{
      title: '不存在页面',
      pageid: 2,
      ns: 0,
      missing: true,
    }];
    mergePages(pageMap, pages);
    expect(pageMap.size).toBe(0);
  });

  // #endregion


  // #region 续传响应合并

  it('rvcontinue 续传：已有页面收到新 revisions -> 更新正文与 revid，追加分类', () => {
    const pageMap = new Map<string, PageRecord>([
      ['沙盒A', {
        title: '沙盒A',
        pageid: 1,
        ns: 0,
        revid: 0,
        text: '',
        categories: ['Category:已有'],
      }],
    ]);
    const pages: ApiResponsePage[] = [{
      title: '沙盒A',
      pageid: 1,
      ns: 0,
      revisions: [{ revid: 200, slots: { main: { content: '完整正文' } } }],
      categories: [{ title: 'Category:新增' }],
    }];
    mergePages(pageMap, pages);
    const page = pageMap.get('沙盒A')!;
    expect(page.text).toBe('完整正文');
    expect(page.revid).toBe(200);
    expect(page.categories).toEqual(['Category:已有', 'Category:新增']);
  });

  it('clcontinue 续传：已有页面收到无 revisions 的响应 -> 仅追加分类，正文不变', () => {
    const pageMap = new Map<string, PageRecord>([
      ['沙盒B', {
        title: '沙盒B',
        pageid: 2,
        ns: 0,
        revid: 300,
        text: '已有正文',
        categories: ['Category:A'],
      }],
    ]);
    const pages: ApiResponsePage[] = [{
      title: '沙盒B',
      pageid: 2,
      ns: 0,
      categories: [{ title: 'Category:B' }, { title: 'Category:C' }],
    }];
    mergePages(pageMap, pages);
    const page = pageMap.get('沙盒B')!;
    expect(page.text).toBe('已有正文');
    expect(page.revid).toBe(300);
    expect(page.categories).toEqual(['Category:A', 'Category:B', 'Category:C']);
  });

  // #endregion


  // #region 多页面批量

  it('单次响应含多个页面 -> 全部写入', () => {
    const pageMap = new Map<string, PageRecord>();
    const pages: ApiResponsePage[] = [
      { title: '页面1', pageid: 1, ns: 0, revisions: [{ revid: 10, slots: { main: { content: '111' } } }] },
      { title: '页面2', pageid: 2, ns: 0, revisions: [{ revid: 20, slots: { main: { content: '222' } } }] },
      { title: '页面3', pageid: 3, ns: 0, missing: true },
    ];
    mergePages(pageMap, pages);
    expect(pageMap.size).toBe(2);
    expect(pageMap.has('页面1')).toBe(true);
    expect(pageMap.has('页面2')).toBe(true);
    expect(pageMap.has('页面3')).toBe(false);
  });

  // #endregion
});


// #region revids比对

// 测试 reconcileRevids 函数（对比 API 与本地 DB 的 revid，计算待补拉与待删除）
describe('reconcileRevids', () => {
  it('API 有、DB 无 -> 待补拉', () => {
    const api = new Map([['新页面', 100]]);
    const db = new Map<string, number>();
    const result = reconcileRevids(api, db);
    expect(result.titlesToFetch).toEqual(new Set(['新页面']));
    expect(result.titlesToDelete.size).toBe(0);
  });

  it('API 与 DB 的 revid 不同 -> 待补拉', () => {
    const api = new Map([['页面A', 200]]);
    const db = new Map([['页面A', 100]]);
    const result = reconcileRevids(api, db);
    expect(result.titlesToFetch).toEqual(new Set(['页面A']));
    expect(result.titlesToDelete.size).toBe(0);
  });

  it('API 与 DB 的 revid 相同 -> 不处理', () => {
    const api = new Map([['页面B', 300]]);
    const db = new Map([['页面B', 300]]);
    const result = reconcileRevids(api, db);
    expect(result.titlesToFetch.size).toBe(0);
    expect(result.titlesToDelete.size).toBe(0);
  });

  it('DB 有、API 无 -> 待删除', () => {
    const api = new Map<string, number>();
    const db = new Map([['过期页面', 400]]);
    const result = reconcileRevids(api, db);
    expect(result.titlesToFetch.size).toBe(0);
    expect(result.titlesToDelete).toEqual(new Set(['过期页面']));
  });

  it('混合场景：部分新增、部分变更、部分删除、部分未变', () => {
    const api = new Map([
      ['新增页', 10],
      ['变更页', 20],
      ['未变页', 30],
    ]);
    const db = new Map([
      ['变更页', 25],
      ['未变页', 30],
      ['删除页', 40],
    ]);
    const result = reconcileRevids(api, db);
    expect(result.titlesToFetch).toEqual(new Set(['新增页', '变更页']));
    expect(result.titlesToDelete).toEqual(new Set(['删除页']));
  });
});

// #endregion


// 测试 fetchPagesWithDeniedIsolation（受限页面导致整批请求被拒时定位并跳过该标题）
describe('fetchPagesWithDeniedIsolation', () => {
  /** 构造访问拒绝错误，字段与 MoegirlRequestError 的 apiCode 一致 */
  function accessDenied(info: string): Error {
    return Object.assign(new Error(info), { apiCode: 'accessdenied' });
  }

  /** 单批请求固定返回的 revid */
  const REVID = 100;

  /**
   * 构造 MoegirlApi 请求替身
   *
   * 与真实 API 一致：请求标题中命中受限列表时整批抛出 accessdenied（不含任何页面数据），
   * 错误信息按 keyword 生成（默认内嵌被拒标题，可传固定文本模拟无法定位标题的情况）。
   *
   * @param restricted 受限标题列表
   * @param keyword 错误信息中的标题文本，缺省为被拒标题本身
   */
  function createApi(restricted: string[], keyword?: string) {
    const post = vi.fn(async (params: { titles: string[] }) => {
      const denied = params.titles.find((title) => restricted.includes(title));
      if (denied) {
        throw accessDenied(`You are not allowed to view ${keyword ?? denied}.`);
      }
      return {
        query: {
          pages: params.titles.map((title, index) => ({
            title,
            pageid: index + 1,
            ns: 0,
            revisions: [{ revid: REVID, slots: { main: { content: `正文${title}` } } }],
          })),
        },
      };
    });
    return { api: { post } as unknown as MoegirlApi, post };
  }

  it('无受限标题 -> 一次请求写入全部页面', async () => {
    const { api, post } = createApi([]);
    const pageMap = new Map<string, PageRecord>();
    const deniedTitles = new Set<string>();

    await fetchPagesWithDeniedIsolation(api, ['页面A', '页面B'], pageMap, deniedTitles);

    expect([...pageMap.keys()]).toEqual(['页面A', '页面B']);
    expect(deniedTitles.size).toBe(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('错误信息内嵌标题 -> 单独验证后只补拉其余标题', async () => {
    const { api, post } = createApi(['页面B']);
    const pageMap = new Map<string, PageRecord>();
    const deniedTitles = new Set<string>();

    await fetchPagesWithDeniedIsolation(api, ['页面A', '页面B', '页面C'], pageMap, deniedTitles);

    expect([...deniedTitles]).toEqual(['页面B']);
    expect([...pageMap.keys()]).toEqual(['页面A', '页面C']);
    // 整批失败 -> 单独验证页面B失败 -> 其余标题一次拉完
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('错误信息无法定位标题 -> 二分缩小到单个标题', async () => {
    const { api } = createApi(['页面B'], 'denied');
    const pageMap = new Map<string, PageRecord>();
    const deniedTitles = new Set<string>();

    await fetchPagesWithDeniedIsolation(api, ['页面A', '页面B'], pageMap, deniedTitles);

    expect([...deniedTitles]).toEqual(['页面B']);
    expect([...pageMap.keys()]).toEqual(['页面A']);
  });

  it('一批含多个受限标题 -> 全部定位并跳过', async () => {
    const { api } = createApi(['页面A', '页面D'], 'denied');
    const pageMap = new Map<string, PageRecord>();
    const deniedTitles = new Set<string>();

    await fetchPagesWithDeniedIsolation(api, ['页面A', '页面B', '页面C', '页面D'], pageMap, deniedTitles);

    expect([...deniedTitles].sort()).toEqual(['页面A', '页面D']);
    expect([...pageMap.keys()]).toEqual(['页面B', '页面C']);
  });

  it('非访问拒绝错误 -> 原样抛出', async () => {
    const api = { post: vi.fn(async () => { throw new Error('网络错误'); }) } as unknown as MoegirlApi;

    await expect(fetchPagesWithDeniedIsolation(api, ['页面A'], new Map(), new Set()))
      .rejects.toThrow('网络错误');
  });
});


// 测试 MessOutput.addPageToList（BFS 遍历分类树查找并插入页面）
describe('MessOutput.addPageToList', () => {
  it('向顶层已有列表添加页面 -> 追加到末尾', () => {
    const data: PageData = { 列表A: ['页面1'] };
    const output = new MessOutput(data);
    output.addPageToList('列表A', '页面2');
    expect(data.列表A).toEqual(['页面1', '页面2']);
  });

  it('向嵌套子节点列表添加页面 -> BFS 找到并追加', () => {
    const data: PageData = {
      父分类: {
        子列表: ['原有页'],
      },
    };
    const output = new MessOutput(data);
    output.addPageToList('子列表', '新增页');
    expect((data.父分类 as PageData).子列表).toEqual(['原有页', '新增页']);
  });

  it('向不存在的列表添加页面 -> 在根节点下新建数组', () => {
    const data: PageData = { 列表A: [] };
    const output = new MessOutput(data);
    output.addPageToList('新列表', '页面X');
    expect(data.新列表).toEqual(['页面X']);
  });

  it('添加页面带有附加信息 -> 正确追加', () => {
    const data: PageData = { 列表B: [] };
    const output = new MessOutput(data);
    output.addPageToList('列表B', ['页面Y', '附加信息']);
    expect(data.列表B).toEqual([['页面Y', '附加信息']]);
  });

  it('标题匹配但值为对象（非数组）-> 不插入直接返回', () => {
    const data: PageData = {
      分类: {
        子项: [],
      },
    };
    const output = new MessOutput(data);
    output.addPageToList('分类', '不应被添加');
    // 分类对应的值仍为对象，未被修改
    expect(data.分类).toEqual({ 子项: [] });
    // 子项也未被修改
    expect((data.分类 as PageData).子项).toEqual([]);
  });
});


// 测试 checkOrder 函数（检查多个位置数组是否在 600 字符内按序排列）
describe('checkOrder', () => {
  it('所有数组为空 -> 返回 0（无误）', () => {
    expect(checkOrder([[], [], []])).toBe(0);
  });

  it('位置按顺序排列 -> 返回 0', () => {
    expect(checkOrder([[10], [50], [100]])).toBe(0);
  });

  it('位置逆序（后一组在前一组之前）-> 返回后一组索引', () => {
    // 第一组在 100，第二组在 50，顺序有误
    expect(checkOrder([[100], [50]])).toBe(1);
  });

  it('超过 600 字符的位置被忽略', () => {
    // 位置 10 和 700：700 超出 600 被过滤，第一组变空，无冲突
    expect(checkOrder([[10], [700]])).toBe(0);
  });

  it('混合边界内外位置：仅比较 600 以内的部分', () => {
    // 第一组 [50, 700]：仅 50 在范围内，maxA=50
    // 第二组 [30, 800]：仅 30 在范围内，minB=30
    // 50 >= 30 -> 顺序有误，返回第二组索引 1
    expect(checkOrder([[50, 700], [30, 800]])).toBe(1);
  });

  it('三组中中间组顺序有误 -> 返回中间组索引', () => {
    // [10] < [200] 正确，[200] > [150] 有误 -> 返回索引 2
    expect(checkOrder([[10], [200], [150]])).toBe(2);
  });
});


// 测试 regexPosition 函数（查找正则表达式在字符串中的所有匹配位置）
describe('regexPosition', () => {
  it('单个匹配 → 返回单元素位置数组', () => {
    expect(regexPosition('abc', /b/g)).toEqual([1]);
  });

  it('多个匹配 → 返回所有位置（升序）', () => {
    expect(regexPosition('a1b2a3a', /a/g)).toEqual([0, 4, 6]);
  });

  it('连续匹配 → 返回相邻位置', () => {
    expect(regexPosition('aaa', /a/g)).toEqual([0, 1, 2]);
  });

  it('无匹配 → 返回空数组', () => {
    expect(regexPosition('hello world', /xyz/g)).toEqual([]);
  });

  it('空字符串 → 返回空数组', () => {
    expect(regexPosition('', /./g)).toEqual([]);
  });

  it('正则含特殊字符', () => {
    // 萌百 wikitext 中的 {{ 双花括号
    expect(regexPosition('{{template|abc}}', /\{\{/g)).toEqual([0]);
  });

  it('正则匹配中文', () => {
    // 页(0)面(1)内(2)容(3)含(4)消(5)歧(6)义(7)，"消歧义"从位置 5 开始
    expect(regexPosition('页面内容含消歧义字样', /消歧义/g)).toEqual([5]);
  });

  it('匹配在字符串开头 → 位置 0', () => {
    expect(regexPosition('abc', /^a/g)).toEqual([0]);
  });

  it('匹配在字符串末尾 → 返回末尾位置', () => {
    expect(regexPosition('abc', /c$/g)).toEqual([2]);
  });
});


// 测试“单独出现的ヘ和リ”仅检查紧邻汉字或平假名的目标字符
describe('单独出现的ヘ和リ', () => {
  it.each([
    ['前后有符号', '|リ|', false],
    ['汉字在前', '汉リ', true],
    ['汉字在后', 'ヘ字', true],
    ['平假名在前', 'かなリ', true],
    ['平假名在后', 'ヘかな', true],
    ['拉丁字母相邻', 'AリB', false],
  ])('%s时判定符合预期', (_scenario, sample, expected) => {
    const data: PageData = { 单独出现的ヘ和リ: [] };
    const output = new MessOutput(data);
    const checks = createMainChecks({ messOutput: output, topTipTemplates: [] });
    const text = `${'a'.repeat(100)}${sample}${'a'.repeat(100)}`;

    for (const check of checks) {
      check(text, [], '测试页面');
    }

    expect(data.单独出现的ヘ和リ).toHaveLength(expected ? 1 : 0);
  });
});
