import { chunk, groupBy } from 'es-toolkit';
import type { TaskHandler } from '../services/tasks/types';

/** 维护组对应的 MediaWiki 用户组 */
const MAINTAINER_GROUPS = ['sysop', 'patroller'];
/** 优编和荣维对应的 MediaWiki 用户组 */
const AUTOPATROLLED_GROUPS = ['goodeditor', 'honoredmaintainer'];

/** 大家族模板记录的用户信息 */
interface UserInfo {
  /** 用户名 */
  username: string;
  /** 显示名 */
  nickname: string;
  /** 下标 */
  subscript: string;
}

/** 模板中的分类栏，用户组不在前两类时归入自确 */
type MemberCategory = 'maintainer' | 'autopatrolled' | 'autoconfirmed';

/** 将用户名规范化为 MediaWiki 标准格式（首字母大写、下划线转空格） */
function normalizeUsername(username: string): string {
  return (username.charAt(0).toUpperCase() + username.slice(1)).replaceAll('_', ' ');
}

/**
 * 更新[[Template:萌百视觉小说研究会]]大家族模板
 *
 * 解析模板中的成员列表，按用户组重新分类为维护组、巡查豁免、自确三栏并提交编辑。
 */
const vnNavboxUpdater: TaskHandler = async ({ api, logger, user }) => {
  const template = 'Template:萌百视觉小说研究会';

  /**
   * 分析模板源代码，提取用户信息列表
   * @param source 模板源代码
   * @returns 用户信息数组
   */
  const parseTemplateSource = (source: string): UserInfo[] => {
    return source
      .replace(/.*<!-- *列表起点 *-->(.*)<!-- *列表终点 *-->.*/gs, '$1') // 提取列表起点终点之间的内容
      .replace(/<!--[\s\S]*?-->/g, '') // 去除注释
      .replace(/\* */g, '') // 去除无序列表头
      .trim()
      .split('\n') // 分割为数组
      .map((str) => {
        const match = str.trim().match(/^([^<(]*)(\(([^)]*)\))?(<.*>)?$/); // 解析昵称和下标
        if (!match) {
          return null;
        }
        return {
          username: match[1].trim(),
          nickname: match[3] ?? '',
          subscript: match[4] ?? '',
        };
      })
      .filter((item): item is UserInfo => item !== null);
  };

  /**
   * 分批获取用户组信息
   * @param userList 用户名列表
   * @param batchSize 单次请求的用户数上限
   * @returns 用户名到用户组列表的映射
   */
  const getUserGroups = async (userList: string[], batchSize: number): Promise<Record<string, string[]>> => {
    const result: Record<string, string[]> = {};
    for (const batch of chunk(userList, batchSize)) {
      const { query: { users } } = await api.post({
        action: 'query',
        list: 'users',
        ususers: batch,
        usprop: 'groups',
      });
      for (const { name, groups } of users) {
        if (groups) {
          result[name] = groups;
        }
      }
    }
    return result;
  };

  /** 将用户信息列表转为模板需要的字符串 */
  const userListToString = (list: UserInfo[] = []) =>
    list
      .map(({ username, nickname, subscript }) => `{{User|${username}${nickname ? `|${nickname}` : ''}}}${subscript}`)
      .join(' • <!--\n    -->');

  const source = await api.getPageSource(template);
  logger.info('获取大家族源代码成功');

  const userInfo = parseTemplateSource(source);
  if (userInfo.length === 0) {
    logger.warn('未解析到用户信息');
    return;
  }
  const batchSize = (await user.getRights()).includes('apihighlimits') ? 500 : 50;
  const userGroups = await getUserGroups(userInfo.map(({ username }) => username), batchSize);
  logger.info('获取用户组信息成功');

  /** 按用户组分类 */
  const groups = groupBy(userInfo, (member): MemberCategory | 'skip' => {
    const userGroup = userGroups[normalizeUsername(member.username)];
    if (!userGroup) {
      return 'skip';
    }
    if (userGroup.some((group) => MAINTAINER_GROUPS.includes(group))) {
      return 'maintainer';
    }
    if (userGroup.some((group) => AUTOPATROLLED_GROUPS.includes(group))) {
      return 'autopatrolled';
    }
    return 'autoconfirmed';
  });

  // 替换模板中各分类栏的内容
  const output = source
    .replace(/(<!-- *维护人员 *-->).*(<!-- *维护人员 *-->)/gs, `$1${userListToString(groups.maintainer)}$2`)
    .replace(/(<!-- *优编荣维 *-->).*(<!-- *优编荣维 *-->)/gs, `$1${userListToString(groups.autopatrolled)}$2`)
    .replace(/(<!-- *自确 *-->).*(<!-- *自确 *-->)/gs, `$1${userListToString(groups.autoconfirmed)}$2`);

  if (output === source) {
    logger.info('用户组信息无变化');
  } else {
    await api.editPage(template, output, '自动更新用户组信息');
  }
};

export default vnNavboxUpdater;
