/**
 * 主进程与渲染进程共享的类型定义
 *
 * 仅放置进程间通信或两边都需要的类型。仅单侧进程使用的类型仍放在各自目录
 */

// #region 设置

/** 关闭窗口行为 */
export type CloseBehavior = 'minimize' | 'exit';

/** 萌娘百科请求域名 */
export type MoegirlDomain = 'mzh.moegirl.org.cn' | 'zh.moegirl.org.cn';

/** 背景轮播模式 */
export type BackgroundMode = 'sequential' | 'random';

/** 应用设置数据（持久化存储形状，主进程 electron-store 与渲染进程 zustand 共用） */
export interface SettingsData {
  /** 界面字体（CSS font-family 值，留空使用默认 sans-serif） */
  uiFont: string;
  /** 日志字体（CSS font-family 值，留空使用默认 monospace） */
  codeFont: string;
  /** 关闭窗口行为 */
  closeBehavior: CloseBehavior;
  /** 任务执行完成（成功/失败）后是否发送系统桌面通知（手动停止不通知） */
  notifyOnTaskComplete: boolean;
  /** 萌娘百科请求域名 */
  moegirlDomain: MoegirlDomain;
  /** 萌娘百科 API 请求的 User-Agent */
  userAgent: string;
  /** 请求重试次数 */
  retryCount: number;
  /** 请求重试间隔（毫秒） */
  retryInterval: number;
  /** 请求超时时间（毫秒，单次请求的最大等待时长） */
  requestTimeout: number;
  /** 全局请求最小间隔（毫秒，0 表示不限速）；所有萌百 API 请求共享，避免高频触发站点限流 */
  minRequestInterval: number;
  /** 背景图片文件路径列表 */
  backgroundImages: string[];
  /** 背景遮罩透明度（0-100） */
  backgroundOpacity: number;
  /** 轮播间隔（毫秒） */
  backgroundInterval: number;
  /** 轮播模式：sequential 顺序 / random 随机 */
  backgroundMode: BackgroundMode;
  /** 背景过渡时长（毫秒，0 表示无过渡） */
  backgroundFadeDuration: number;
}

// #endregion


// #region 账号

/** 持久化账号记录，首项为默认账号 */
export interface AccountRecord {
  /** 账号唯一标识（uuid） */
  id: string;
  /** MediaWiki 用户名 */
  username: string;
  /** 用户 ID（用于头像 URL，登录后填充） */
  userId: string | null;
}

/** 用户组与权限信息（MediaWiki users 接口返回，跨层共用） */
export interface UserInfo {
  /** 用户组 */
  groups: string[];
  /** 用户权限 */
  rights: string[];
  /** 显示昵称（萌娘百科 moedisplayname，未设置时为 null） */
  displayname: string | null;
  /** 显示标签（昵称后缀，未设置时为 null） */
  displaytag: string | null;
}

/** 账号完整信息（含登录态与用户信息，通过 IPC 传输到渲染进程展示） */
export interface Account extends AccountRecord, UserInfo {
  /** 当前是否处于登录态（由 session cookie 推断） */
  loggedIn: boolean;
}

// #endregion


// #region 任务

/** 任务基础标识（所有涉及任务引用的接口共用） */
export interface TaskKeyed {
  /** 任务唯一标识（不可变） */
  taskKey: string;
}

/** 任务定义（主进程注册表提供，通过 IPC 传输到渲染进程） */
export interface TaskDefinition extends TaskKeyed {
  /** 默认名称 */
  defaultName: string;
  /** 默认描述（可选） */
  defaultDescription?: string;
  /** 任务参数字段定义（用于渲染进程动态生成输入框，可选） */
  params?: TaskParamField[];
}

/** 用户通过界面覆盖的显示设置 */
export interface TaskOverrides {
  /** 覆盖的名称（为空则使用 defaultName） */
  name?: string;
  /** 覆盖的描述（为空则使用 defaultDescription） */
  description?: string;
}

/** 任务参数字段类型 */
export type TaskParamType =
  'string' |
  'number' |
  'text' |
  'multi-string' |
  'select' |
  'multi-select';

/** Select 下拉框选项 */
export interface TaskParamOption {
  /** 选项显示文本 */
  label: string;
  /** 选项值 */
  value: string;
}

/**
 * 任务参数字段定义
 *
 * 在注册表中声明，渲染进程据此动态生成输入框；
 * 执行时由 runner 合并默认值与用户输入后注入 ctx.params。
 */
export interface TaskParamField {
  /** 参数键名（对应 ctx.params 中的键） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 字段类型：string 单行文本 / number 数字 / text 多行文本 / multi-string 多值文本（标签输入）/ select 下拉单选 / multi-select 下拉多选 */
  type: TaskParamType;
  /** 默认值（可选，用户未输入时使用；multi-string 与 multi-select 为 string[]） */
  default?: number | string | string[];
  /** 占位提示（可选） */
  placeholder?: string;
  /** 是否必填（可选，默认 false） */
  required?: boolean;
  /** 帮助提示（可选，鼠标悬浮显示） */
  help?: string;
  /** 下拉选项（仅 type 为 select 或 multi-select 时有效） */
  options?: TaskParamOption[];
}

/** 任务运行时参数值（键名与 TaskParamField.key 对应） */
export type TaskParamValues = Record<string, number | string | string[]>;

/** 任务调度配置（持久化存储） */
export interface TaskConfig {
  /** 调度规则（cron 表达式，如 "0 1 * * *" 表示每天 1:00） */
  cron: string;
  /** 是否启用 */
  enabled: boolean;
  /** 执行该任务的账号 id（未设置时回退到默认账号） */
  accountId?: string;
  /** 用户覆盖的显示设置 */
  overrides?: TaskOverrides;
  /** 用户填写的任务参数值（与注册表 params 字段对应，未填项由 runner 回退默认值） */
  params?: TaskParamValues;
}

/**
 * 任务配置持久化数据
 *
 * order 与 configs 分离存储，避免在配置表中混入非任务的保留键，
 * 使读端无需对 IPC/磁盘数据做结构性的类型断言。
 */
export interface TaskConfigStoreData {
  /** 任务排序顺序（taskKey 数组，缺失项由渲染进程追加到末尾） */
  order: string[];
  /** 任务配置集合（taskKey -> TaskConfig） */
  configs: Record<string, TaskConfig>;
}

/** 任务执行记录（单次任务运行的执行结果，持久化存储） */
export interface TaskRunRecord extends TaskKeyed {
  /** 执行开始时间（时间戳，毫秒） */
  startTime: number;
  /** 执行结束时间（时间戳，毫秒） */
  endTime: number;
  /** 是否执行成功 */
  success: boolean;
  /** 是否被手动停止（与 success 互斥，统计时单独计算） */
  aborted?: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/** 错过的任务执行信息（启动时检查关闭期间漏掉的预期触发） */
export interface MissedTaskInfo extends TaskKeyed {
  /** 任务显示名称 */
  taskName: string;
  /** 错过的最近一次预期触发时间（毫秒时间戳） */
  lastExpectedTime: number;
  /** 上次执行结束时间（毫秒时间戳，无记录时为 null） */
  lastRunTime: number | null;
}

// #endregion


// #region 日志

/** 日志级别 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** 任务日志事件载荷（main → renderer via 'task:log'） */
export interface TaskLogPayload extends TaskKeyed {
  /** 日志级别 */
  level: LogLevel;
  /** 日志文本 */
  message: string;
  /** 是否为执行器发出的系统消息（如任务开始/结束），渲染时显示【SYS】替代任务名 */
  system?: boolean;
  /** 请求/响应等详细诊断信息（持久化到日志文件，界面中可折叠查看；可选） */
  detail?: string;
}

/** 任务日志事件（含时间戳，用于 IPC 推送与持久化存储） */
export interface TaskLogEvent extends TaskLogPayload {
  /** 日志事件唯一标识；用于渲染进程合并历史日志与实时日志时去重 */
  eventId?: string;
  /** 日志时间（YYYY-MM-DD HH:mm:ss，本地时间） */
  time: string;
}

/** 任务运行状态事件（main → renderer via 'task:status'） */
export interface TaskStatusPayload extends TaskKeyed {
  /** 是否正在运行 */
  running: boolean;
}

/** task:run 返回结果：成功时无 error，失败时携带错误信息 */
export type TaskRunResult =
  | { success: true }
  | { success: false; error: string };

// #endregion
