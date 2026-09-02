/**
 * 网页演示模式的模拟数据
 *
 * 仅在网页环境（无 Electron preload）下使用：
 * - 任务定义照抄主进程 registry 的元数据，保证演示效果与实际应用一致
 * - 背景图与头像均为静态引入的明确资源文件，增删图片需同步修改本文件
 */
import dayjs from 'dayjs';
import { shuffle } from 'es-toolkit';
import { createDefaultSettings } from '@shared/settings';
import type {
  Account,
  SettingsData,
  TaskConfigStoreData,
  TaskDefinition,
  TaskLogEvent,
  TaskRunRecord,
} from '@shared/types';
import avatarBearBin from '../assets/avatar-BearBin.jpg';
import avatarBearBot from '../assets/avatar-BearBot.jpg';
import backgroundImage1 from '../assets/background1.jpg';
import backgroundImage2 from '../assets/background2.jpg';
import backgroundImage3 from '../assets/background3.jpg';

/** 生成 [min, max] 范围内的随机整数 */
export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 将日志步骤中的 {} 占位符替换为取值区间内的随机整数 */
export function fillMessage(message: string, values?: Array<[number, number]>): string {
  if (!values) {
    return message;
  }
  let index = 0;
  return message.replace(/\{\}/g, () => {
    const [min, max] = values[index++];
    return String(randomInt(min, max));
  });
}

/** 演示模式背景图 URL 列表（与设置界面的展示顺序一致） */
export const MOCK_BACKGROUND_IMAGES: string[] = [
  backgroundImage1,
  backgroundImage2,
  backgroundImage3,
];

/**
 * 演示模式任务定义（与主进程 TASK_REGISTRY 元数据保持一致）
 *
 * 从 9 个真实任务中挑选 5 个覆盖不同复杂度梯度与输出形态的样本：
 * - suffix：无参数，更新报告页
 * - disambig-link-in-nav：单参数，递归展开分类
 * - vn-edit-stat：必填数字参数，统计表输出
 * - sync-feishu-to-userpage：双字符串参数，跨平台同步
 * - mess-updater：无参数，数据库增量比对
 */
export const MOCK_TASK_DEFINITIONS: TaskDefinition[] = [
  {
    taskKey: 'suffix',
    defaultName: '检查消歧义后缀',
    defaultDescription: '更新[[萌娘百科:疑似多余消歧义后缀]]页面',
  },
  {
    taskKey: 'disambig-link-in-nav',
    defaultName: '检查导航模板中的消歧义链接',
    defaultDescription: '更新[[萌娘百科:链接到消歧义页面的导航模板]]页面',
    params: [
      {
        key: 'interval',
        label: '请求间隔(ms)',
        type: 'number',
        default: 500,
        help: '递归请求分类与链接时的等待时间（毫秒），避免请求过于密集',
      },
    ],
  },
  {
    taskKey: 'vn-edit-stat',
    defaultName: '更新视研会活跃度统计',
    defaultDescription: '更新[[User:BearBin/视研会30日编辑数统计]]',
    params: [
      {
        key: 'timeLength',
        label: '统计天数',
        type: 'number',
        default: 30,
        required: true,
        help: '统计最近多少天内的编辑数',
      },
    ],
  },
  {
    taskKey: 'sync-feishu-to-userpage',
    defaultName: '同步飞书表格到用户页',
    defaultDescription: '同步飞书 galgame 条目统计表到[[User:柏喙意志/Gal条目表]]',
    params: [
      { key: 'appId', label: '飞书 App ID', type: 'string', required: true, placeholder: 'cli_xxx' },
      { key: 'appSecret', label: '飞书 App Secret', type: 'string', required: true },
    ],
  },
  {
    taskKey: 'mess-updater',
    defaultName: '更新杂物间',
    defaultDescription: '更新[[User:BearBin/杂物]]页面',
  },
];

/**
 * 演示模式默认账号列表（有序，首项为默认账号）
 *
 * 两个账号用于演示默认账号切换功能；userId 存放静态引入的头像资源 URL，
 * avatarUrl 对 URL 形式的 userId 直通返回。
 * groups / rights 参照萌娘百科真实用户组权限：
 * - BearBot：机器人、延伸确认用户
 * - BearBin：延伸确认用户、维护姬、界面管理员
 */
export const MOCK_ACCOUNTS: Account[] = [
  {
    id: 'mock-account-bearbot',
    username: 'BearBot',
    userId: avatarBearBot,
    groups: ['*', 'user', 'extendedconfirmed', 'bot'],
    rights: [
      'read', 'edit', 'createpage', 'createtalk', 'upload', 'minoredit', 'applychangetags', 'changetags',
      'extendedconfirmed', 'bot', 'autoconfirmed', 'editsemiprotected', 'nominornewtalk',
      'autopatrol', 'suppressredirect', 'apihighlimits', 'noratelimit', 'move', 'movefile',
    ],
    displayname: 'BearBot',
    displaytag: null,
    loggedIn: true,
  },
  {
    id: 'mock-account-bearbin',
    username: 'BearBin',
    userId: avatarBearBin,
    groups: ['*', 'user', 'extendedconfirmed', 'patroller', 'interface-admin'],
    rights: [
      'read', 'edit', 'createpage', 'createtalk', 'upload', 'minoredit', 'applychangetags', 'changetags', 'sendemail',
      'extendedconfirmed', 'autopatrol', 'patrol', 'patrolleredit', 'rollback', 'suppressredirect', 'unwatchedpages',
      'editinterface', 'editsitecss', 'editsitejson', 'editsitejs', 'editusercss', 'edituserjson', 'edituserjs', 'techedit',
    ],
    displayname: 'BearBin',
    displaytag: null,
    loggedIn: true,
  },
];

/** 演示模式初始任务调度配置（取自实际部署的 electron-store 数据，仅保留演示包含的 5 个任务） */
export const MOCK_TASK_CONFIGS: TaskConfigStoreData = {
  order: ['suffix', 'disambig-link-in-nav', 'mess-updater', 'sync-feishu-to-userpage', 'vn-edit-stat'],
  configs: {
    suffix: {
      cron: '0 7 * * 2',
      enabled: true,
      overrides: {
        name: '检查消歧义后缀',
        description: '更新[[萌娘百科:疑似多余消歧义后缀]]页面',
      },
    },
    'disambig-link-in-nav': {
      cron: '0 7 * * 4',
      enabled: true,
      overrides: {
        name: '检查导航模板中的消歧义链接',
        description: '更新[[萌娘百科:链接到消歧义页面的导航模板]]页面',
      },
      params: {},
    },
    'mess-updater': {
      cron: '0 7 * * 5',
      enabled: true,
      overrides: {
        name: '更新杂物间',
        description: '更新[[User:BearBin/杂物]]页面',
      },
    },
    'sync-feishu-to-userpage': {
      cron: '30 7 * * 3',
      enabled: true,
      overrides: {
        name: '同步飞书表格到用户页',
        description: '同步飞书 galgame 条目统计表到[[User:柏喙意志/Gal条目表]]',
      },
      params: {
        appId: 'cli_a4586356dbfa100c',
        appSecret: '',
      },
    },
    'vn-edit-stat': {
      cron: '30 7 * * 4',
      enabled: true,
      overrides: {
        name: '更新视研会活跃度统计',
        description: '更新[[User:BearBin/视研会30日编辑数统计]]',
      },
      params: {
        timeLength: 30,
      },
    },
  },
};

/**
 * 计算指定周几（0=周日）最近一次已过去的定时执行时刻（07:00:00）
 *
 * 以执行时刻为界：执行日当天 07:00 前进入返回上周的同一天，07:00 起返回当天
 */
function lastWeekday(weekday: number): dayjs.Dayjs {
  let date = dayjs().day(weekday).hour(7).minute(0).second(0).millisecond(0);
  if (date.isAfter(dayjs())) {
    date = date.subtract(7, 'day');
  }
  return date;
}

/**
 * 生成演示模式初始任务执行记录
 *
 * - suffix / disambig 与历史日志（createMockLogs）的时间对齐：分别为上一个周二、
 *   上上周四 07:00 的定时执行，使「本周」「本月」统计口径下各有展示内容
 * - 其余任务随机分布在近几天
 */
export function createMockRunRecords(): TaskRunRecord[] {
  const now = Date.now();
  const records: TaskRunRecord[] = [];

  /** 构造一条执行记录并加入结果 */
  const push = (taskKey: string, startTime: number, endTime: number, success: boolean, aborted?: boolean) => {
    records.push({
      taskKey,
      startTime,
      endTime,
      success,
      ...(aborted ? { aborted } : {}),
      ...(!success && !aborted ? { error: '模拟演示：请求超时（演示数据）' } : {}),
    });
  };

  // 与历史日志同源的两次定时执行（时长与日志时间轴一致）
  const suffixStart = lastWeekday(2).valueOf();
  push('suffix', suffixStart, suffixStart + 180 * 1000, true);
  const disambigStart = lastWeekday(4).subtract(7, 'day').valueOf();
  push('disambig-link-in-nav', disambigStart, disambigStart + 806 * 1000, true);

  // 其余任务随机分布在近几天（时长与各自日志时间轴量级一致）
  const scenarios: Array<[string, number, number, boolean, boolean]> = [
    // [任务 key，距今天数，执行时长（秒），是否成功，是否被手动停止]
    ['mess-updater', 1, 61, true, false],
    ['vn-edit-stat', 3, 13, true, true],
    ['sync-feishu-to-userpage', 5, 7, false, false],
  ];
  for (const [taskKey, daysAgo, duration, success, aborted] of scenarios) {
    const startTime = now - daysAgo * 24 * 60 * 60 * 1000 - Math.floor(Math.random() * 6) * 60 * 60 * 1000;
    const endTime = startTime + duration * 1000;
    push(taskKey, startTime, endTime, success, aborted);
  }
  return records;
}

/**
 * 创建演示模式默认设置
 *
 * 背景图列表取打包资源 URL 并随机排序，使进入页面时初始展示的背景随机
 * （前端固定展示列表首项）
 */
export function createMockSettings(): SettingsData {
  return {
    ...createDefaultSettings(__APP_VERSION__),
    backgroundImages: shuffle([...MOCK_BACKGROUND_IMAGES]),
  };
}

/** 任务模拟运行脚本中的单条日志步骤 */
export interface MockLogStep {
  /** 日志文本，数字占位符 {} 按 values 顺序填充 */
  message: string;
  /** 占位符取值区间（运行时在闭区间内取随机整数，保持真实量级） */
  values?: Array<[number, number]>;
  /** 距上一条日志的秒数（运行时小幅抖动，默认 1） */
  gap?: number;
  /** 真实执行中距上一条日志的秒数（createMockLogs 编排历史日志时间轴时使用） */
  realGap?: number;
}

/**
 * 各任务的模拟运行脚本（按真实执行顺序播放一次，文案与 electron/tasks 任务脚本内的日志调用一致）
 *
 * 文案来源：
 * - suffix / disambig-link-in-nav / vn-edit-stat / sync-feishu-to-userpage / mess-updater 各任务脚本
 * - 「正在保存到[[xxx]]」「保存成功」来自 MoegirlApi.editPage
 */
export const MOCK_TASK_RUN_SCRIPTS: Record<string, MockLogStep[]> = {
  suffix: [
    { message: '开始获取所有页面列表', gap: 1, realGap: 0 },
    { message: '获取到{}个页面', values: [[220000, 230000]], gap: 2, realGap: 135 },
    { message: '获取到{}个疑似多余的消歧义后缀页面', values: [[760, 860]], gap: 1, realGap: 0 },
    { message: '开始获取重定向页面', gap: 1, realGap: 0 },
    { message: '获取到{}个后缀重定向至无后缀，{}个无后缀重定向至后缀', values: [[16, 24], [55, 68]], gap: 2, realGap: 42 },
    { message: '正在保存到[[萌娘百科:疑似多余消歧义后缀]]', gap: 1, realGap: 0 },
    { message: '保存成功', gap: 1, realGap: 2 },
  ],
  'disambig-link-in-nav': [
    { message: '开始获取消歧义页列表……', gap: 1, realGap: 0 },
    { message: '获取到{}个消歧义页及其重定向', values: [[6000, 8000]], gap: 2, realGap: 1 },
    { message: '开始获取导航模板及其链接……', gap: 1, realGap: 0 },
    { message: '已检查1000个模板', gap: 2, realGap: 75 },
    { message: '已检查2000个模板', gap: 2, realGap: 336 },
    { message: '已检查3000个模板', gap: 1, realGap: 67 },
    { message: '已检查4000个模板', gap: 1, realGap: 0 },
    { message: '已检查5000个模板', gap: 2, realGap: 147 },
    { message: '获取到{}个模板，正在筛选其中的消歧义链接……', values: [[5000, 6000]], gap: 1, realGap: 171 },
    { message: '筛选出{}个含消歧义链接的模板', values: [[140, 180]], gap: 1, realGap: 0 },
    { message: '正在保存到[[萌娘百科:链接到消歧义页面的导航模板]]', gap: 1, realGap: 0 },
    { message: '保存成功', gap: 3, realGap: 8 },
  ],
  'vn-edit-stat': [
    { message: '获取视研会模板源代码成功', gap: 1, realGap: 1 },
    { message: '开始获取{}名成员近{}日的编辑数据……', values: [[100, 120], [30, 30]], gap: 2, realGap: 2 },
    { message: '获取编辑数据成功', gap: 2, realGap: 7 },
    { message: '正在保存到[[User:BearBin/视研会30日编辑数统计]]', gap: 1, realGap: 0 },
    { message: '保存成功', gap: 1, realGap: 2 },
  ],
  'sync-feishu-to-userpage': [
    { message: '获取飞书访问token成功', gap: 1, realGap: 0 },
    { message: '读取飞书统计表成功，共 {} 行', values: [[800, 1000]], gap: 2, realGap: 0 },
    { message: '正在保存到[[User:柏喙意志/Gal条目表]]', gap: 1, realGap: 0 },
    { message: '保存成功', gap: 1, realGap: 6 },
  ],
  'mess-updater': [
    { message: '开始拉取页面 revid 清单……', gap: 1, realGap: 0 },
    { message: '命名空间0：{}个页面', values: [[220000, 230000]], gap: 2, realGap: 2 },
    { message: '命名空间10：{}个页面', values: [[14000, 16000]], gap: 1, realGap: 1 },
    { message: 'revid 清单拉取完毕，共{}个页面', values: [[235000, 250000]], gap: 2, realGap: 0 },
    { message: '比对完毕：待补拉{}个、待删除{}个', values: [[4500, 5500], [15, 40]], gap: 1, realGap: 1 },
    { message: '补拉完毕，共写入{}个页面', values: [[4500, 5500]], gap: 2, realGap: 30 },
    { message: '已删除{}个过期页面', values: [[15, 40]], gap: 1, realGap: 1 },
    { message: '本地共{}个页面，开始执行检查', values: [[235000, 245000]], gap: 1, realGap: 0 },
    { message: '已检查50000个页面', gap: 2, realGap: 2 },
    { message: '已检查100000个页面', gap: 2, realGap: 2 },
    { message: '已检查150000个页面', gap: 2, realGap: 2 },
    { message: '已检查200000个页面', gap: 2, realGap: 2 },
    { message: '检查完毕，共检查{}个页面', values: [[235000, 245000]], gap: 1, realGap: 0 },
    { message: '主名字空间疑似繁体命名检查完毕', gap: 1, realGap: 9 },
    { message: '模板名字空间疑似繁体命名检查完毕', gap: 1, realGap: 1 },
    { message: '分类空间疑似繁体命名检查完毕', gap: 1, realGap: 5 },
    { message: '正在保存到[[User:BearBin/杂物]]', gap: 1, realGap: 0 },
    { message: '保存成功', gap: 1, realGap: 2 },
    { message: '任务完成', gap: 1, realGap: 0 },
  ],
};

/**
 * 生成演示模式历史日志
 *
 * 文案复用 MOCK_TASK_RUN_SCRIPTS（单一来源），时间用 realGap 按真实执行节奏编排：
 * - 检查消歧义后缀：上一个周二 07:00:00 起约 3 分钟（一周内，进入「本周」统计）
 * - 检查导航模板中的消歧义链接：上上周四 07:00:00 起约 13 分钟（超过一周，
 *   仅进入「本月」统计，与执行记录 createMockRunRecords 的时间保持一致）
 */
export function createMockLogs(): TaskLogEvent[] {
  const buildHistory = (taskKey: string, taskName: string, start: dayjs.Dayjs): TaskLogEvent[] => {
    let offset = 0;
    let seq = 0;
    const events: TaskLogEvent[] = [];

    /** 追加一条历史日志事件 */
    const push = (level: TaskLogEvent['level'], message: string, system?: boolean) => {
      events.push({
        taskKey,
        level,
        message,
        time: start.add(offset, 'second').format('YYYY-MM-DD HH:mm:ss'),
        eventId: `${taskKey}-${start.valueOf()}-${seq++}`,
        ...(system ? { system } : {}),
      });
    };

    push('INFO', `开始执行任务【${taskName}】`, true);
    for (const step of MOCK_TASK_RUN_SCRIPTS[taskKey] ?? []) {
      offset += step.realGap ?? 0;
      push('INFO', fillMessage(step.message, step.values));
    }
    offset += 1;
    push('INFO', `【${taskName}】执行完成`, true);
    return events;
  };

  return [
    ...buildHistory('suffix', '检查消歧义后缀', lastWeekday(2)),
    ...buildHistory('disambig-link-in-nav', '检查导航模板中的消歧义链接', lastWeekday(4).subtract(7, 'day')),
  ].sort((a, b) => a.time.localeCompare(b.time));
}
