/**
 * 任务注册表（主进程单一数据源）
 *
 * - `TASK_REGISTRY`：任务注册表，存储所有任务的元数据和执行函数
 * - `getTaskDefinitions`：获取所有任务定义，用于 IPC 传输到渲染进程
 */
import type { TaskDefinition, TaskParamField } from '@shared/types';
import type { TaskHandler } from './types';
import suffixHandler from '../../tasks/suffix';
import disambigLinkInNavHandler from '../../tasks/disambig-link-in-nav';
import requiredDisambigHandler from '../../tasks/required-disambig';
import halfWidthHandler from '../../tasks/half-width';
import vnNavboxUpdater from '../../tasks/vn-navbox-updater';
import vnEditStat from '../../tasks/vn-edit-stat';
import syncFeishuTableData from '../../tasks/sync-feishu-tabledata';
import messUpdater from '../../tasks/mess-updater';

/** 任务注册表项（元数据 + 执行函数） */
interface TaskEntry {
  /** 默认名称 */
  defaultName: string;
  /** 默认描述（可选） */
  defaultDescription?: string;
  /** 任务参数字段定义（可选，渲染进程据此动态生成输入框） */
  params?: TaskParamField[];
  /** 任务执行函数 */
  handler: TaskHandler;
}

/** 任务注册表 */
export const TASK_REGISTRY: Record<string, TaskEntry> = {
  suffix: {
    defaultName: '检查消歧义后缀',
    defaultDescription: '更新[[萌娘百科:疑似多余消歧义后缀]]页面',
    handler: suffixHandler,
  },
  'disambig-link-in-nav': {
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
    handler: disambigLinkInNavHandler,
  },
  'required-disambig': {
    defaultName: '检查需要创建的消歧义',
    defaultDescription: '更新[[User:BearBin/可能需要创建的消歧义页面]]页面',
    handler: requiredDisambigHandler,
  },
  'half-width': {
    defaultName: '检查需要改为全角标点的标题',
    defaultDescription: '更新[[User:BearBin/可能需要改为全角标点标题的页面]]页面',
    handler: halfWidthHandler,
  },
  'vn-navbox-updater': {
    defaultName: '更新视研会大家族模板',
    defaultDescription: '更新[[Template:萌百视觉小说研究会]]',
    handler: vnNavboxUpdater,
  },
  'vn-edit-stat': {
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
    handler: vnEditStat,
  },
  'sync-feishu-to-userpage': {
    defaultName: '同步飞书表格到用户页',
    defaultDescription: '同步飞书 galgame 条目统计表到[[User:柏喙意志/Gal条目表]]',
    params: [
      {
        key: 'appId',
        label: '飞书 App ID',
        type: 'string',
        required: true,
        placeholder: 'cli_xxx',
      },
      {
        key: 'appSecret',
        label: '飞书 App Secret',
        type: 'string',
        required: true,
      },
    ],
    handler: syncFeishuTableData,
  },
  'mess-updater': {
    defaultName: '更新杂物间',
    defaultDescription: '更新[[User:BearBin/杂物]]页面',
    handler: messUpdater,
  },
};

/** 获取所有任务定义，用于 IPC 传输到渲染进程 */
export function getTaskDefinitions(): TaskDefinition[] {
  return Object.entries(TASK_REGISTRY).map(([taskKey, { defaultName, defaultDescription, params }]) => ({
    taskKey,
    defaultName,
    defaultDescription,
    params,
  }));
}
