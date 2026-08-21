/**
 * 渲染进程类型定义
 *
 * 与主进程共享的类型放在 @shared/types，此处仅保留渲染进程专属类型
 * （TaskInfo：合并后的完整任务信息，用于 UI 展示）。
 */
import type { TaskDefinition, TaskParamValues } from '@shared/types';

/** 任务完整信息（用于 UI 展示，合并 definition + config） */
export interface TaskInfo extends TaskDefinition {
  /** 显示名称（优先使用 overrides.name，否则使用 defaultName） */
  name: string;
  /** 显示描述（优先使用 overrides.description，否则使用 defaultDescription，可选） */
  description?: string;
  /** cron 表达式 */
  cron: string;
  /** 是否启用 */
  enabled: boolean;
  /** 绑定的执行账号 id（未设置时回退到默认账号） */
  accountId?: string;
  /** 用户填写的任务参数值（来自持久化配置，未填项使用字段默认值占位） */
  paramValues?: TaskParamValues;
}
