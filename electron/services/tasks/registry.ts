/**
 * 任务注册表（主进程单一数据源）
 *
 * - `TASK_REGISTRY`：任务注册表，存储所有任务的元数据和执行函数
 * - `getTaskDefinitions`：获取所有任务定义，用于 IPC 传输到渲染进程
 */
import type { TaskDefinition, TaskParamField } from '@shared/types';
import type { TaskHandler } from './types';
import taskExample from '../../tasks/task-example';

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
  'task-example': {
    defaultName: '示例任务',
    defaultDescription: '示例任务，获取站点信息、输出日志',
    params: [
      {
        key: 'greeting',
        label: '问候对象',
        type: 'string',
        required: true,
        placeholder: '如：世界',
        help: '任务开始时输出的问候语对象，留空使用默认值',
      },
      {
        key: 'number',
        label: '输入数字',
        type: 'number',
      },
      {
        key: 'text',
        label: '输入文本',
        type: 'text',
      },
      {
        key: 'keywords',
        label: '关键词列表',
        type: 'multi-string',
        default: ['默认关键词'],
        placeholder: '输入后回车添加，支持逗号分隔',
        help: '多值参数示例，输入的每一项作为一个标签',
      },
      {
        key: 'mode',
        label: '执行模式',
        type: 'select',
        default: 'normal',
        options: [
          { label: '普通', value: 'normal' },
          { label: '详细', value: 'verbose' },
          { label: '静默', value: 'silent' },
        ],
        help: '单选下拉框示例',
      },
      {
        key: 'namespaces',
        label: '命名空间',
        type: 'multi-select',
        default: ['0'],
        options: [
          { label: '主空间', value: '0' },
          { label: '讨论', value: '1' },
          { label: '用户', value: '2' },
          { label: '模板', value: '10' },
        ],
        placeholder: '可多选',
        help: '多选下拉框示例',
      },
    ],
    handler: taskExample,
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
