import { chunk, uniqBy } from 'es-toolkit';
import type { TaskHandler } from '../services/tasks/types';

/** 翻页请求间的等待时间（毫秒），避免请求过于密集 */
const REQUEST_INTERVAL = 500;

/** API 响应的用户贡献数据 */
interface UserContrib {
  userid: number;
  user: string;
}

/** 将用户名规范化为 MW 标准格式（首字母大写、下划线转空格），用于统一请求与响应中的用户名匹配 */
function normalizeUsername(username: string): string {
  return (username.charAt(0).toUpperCase() + username.slice(1)).replaceAll('_', ' ');
}

/**
 * 更新 {@link https://zh.moegirl.org.cn/User:BearBin/视研会30日编辑数统计 User:BearBin/视研会30日编辑数统计}
 *
 * 根据 {@link https://zh.moegirl.org.cn/Template:萌百视觉小说研究会 萌百视觉小说研究会} 的成员列表，
 * 统计各成员近30日（或动态配置的时长）在主/模板/分类/模块命名空间内的编辑数，生成表格写入统计页面。
 */
const vnEditStat: TaskHandler = async ({ api, logger, user, sleep, params }) => {
  /**
   * 分析模板源代码，提取用户名列表
   *
   * 保留模板中的原始写法用于表格显示；去重时按规范化名判断（首字母大写、下划线转空格），
   * 仅保留首次出现的原始写法，避免下划线/空格混写导致重复。
   * @param source 模板源代码
   * @returns 去重后的用户名数组（保持模板原样）
   */
  const parseTemplateSource = (source: string): string[] => {
    const usernames = source
      .replace(/.*<!-- *列表起点 *-->(.*)<!-- *列表终点 *-->.*/gs, '$1') // 提取列表起点终点之间的内容
      .replace(/<!--[\s\S]*?-->/g, '') // 去除注释
      .replace(/\* */g, '') // 去除无序列表头
      .trim()
      .split('\n') // 分割为数组
      .map((str) => str.trim().match(/^([^<(]*)(\(([^)]*)\))?(<.*>)?$/)?.[1].trim()) // 解析用户名（去除昵称和下标）
      .filter((username): username is string => username !== undefined && username !== '');
    return uniqBy(usernames, normalizeUsername);
  };

  /**
   * 批量获取多个用户指定时间范围内的编辑数
   *
   * 响应中每条记录为一次编辑，按规范化后的 user 字段累计各用户编辑数。
   *
   * @param userList 用户名列表
   * @param batchSize 单批用户数上限（受 apihighlimits 影响，500 或 50）
   * @param ucend 最早读取时间（ISO 8601）
   * @returns 用户名到编辑数的映射（无编辑记录的用户不在其中）
   */
  const getEditCounts = async (
    userList: string[],
    batchSize: number,
    ucend: string,
  ): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};
    for (const batch of chunk(userList, batchSize)) {
      const baseParams = {
        action: 'query',
        list: 'usercontribs',
        uclimit: 'max',
        ucdir: 'older',
        ucend,
        ucuser: batch,
        ucnamespace: ['0', '10', '14', '828'], // 统计范围：主、模板、分类、模块
        ucprop: '',
      };
      let uccontinue: string | false = false;
      do {
        const request = { ...baseParams, uccontinue };
        const response = await api.post(request);
        for (const contrib of (response.query?.usercontribs as UserContrib[] | undefined) ?? []) {
          const username = normalizeUsername(contrib.user);
          counts[username] = (counts[username] ?? 0) + 1;
        }
        uccontinue = response.continue?.uccontinue || false;
        // 翻页间短暂等待，避免请求过于密集
        if (uccontinue) {
          await sleep(REQUEST_INTERVAL);
        }
      } while (uccontinue);
    }
    return counts;
  };

  const source = await api.getPageSource('Template:萌百视觉小说研究会'); // 从视研会模板获取用户列表
  logger.info('获取视研会模板源代码成功');

  const userList = parseTemplateSource(source);
  if (userList.length === 0) {
    logger.warn('未解析到用户信息');
    return;
  }

  // 统计时间范围（天），可通过任务参数配置，无效或未传时回退到默认值
  const rawTimeLength = Number(params.timeLength);
  const timeLength = Number.isFinite(rawTimeLength) && rawTimeLength > 0 ? rawTimeLength : 30;

  const batchSize = (await user.getRights()).includes('apihighlimits') ? 500 : 50;
  const ucend = new Date(Date.now() - timeLength * 24 * 60 * 60 * 1000).toISOString();
  logger.info(`开始获取${userList.length}名成员近${timeLength}日的编辑数据……`);
  const editCounts = await getEditCounts(userList, batchSize, ucend);
  logger.info('获取编辑数据成功');

  // 生成统计表格，保持模板列表顺序与原始写法，匹配时按规范化名取编辑数，无编辑记录的用户计为 0
  const rows = userList
    .map((username) => `| [[User:${username}|${username}]] || ${editCounts[normalizeUsername(username)] ?? 0}`)
    .join('\n|-\n');
  const text =
    `*本页面为机器人生成的[[T:萌百视觉小说研究会|视研会]]成员${timeLength}日内编辑数统计（主<code>(namespace=0)</code>、分类<code>(category:)</code>、模板<code>(template:)</code>、模块<code>(module:)</code>）\n` +
    `*生成时间：{{subst:#time:Y年n月j日 (D) H:i (T)|||1}}｜{{subst:#time:Y年n月j日 (D) H:i (T)}}\n` +
    `<center>\n` +
    `{| class="wikitable sortable"\n` +
    `! 用户名 !! ${timeLength}日编辑数\n|-\n${rows}\n|}\n</center>`;

  // 保存到目标页面
  const targetPage = 'User:BearBin/视研会30日编辑数统计';
  await api.editPage(targetPage, text, '自动更新列表');
};

export default vnEditStat;
