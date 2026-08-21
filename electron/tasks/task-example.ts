import type { TaskHandler } from '../services/tasks/types';

/**
 * 任务脚本示例
 *
 * 演示任务执行流程：输出问候语、获取站点信息、输出日志。
 * 演示任务参数：通过 ctx.params.greeting 读取注册表中声明的“问候对象”参数。
 * 用于验证任务调度、日志推送、参数注入等功能。
 */
const taskExample: TaskHandler = async ({ logger, api, params }) => {
  const greeting = params.greeting !== undefined ? String(params.greeting) : '';
  if (greeting) {
    logger.info(`你好，${greeting}！`);
  }

  // 多值参数示例：multi-string 类型在 ctx.params 中为 string[]
  const keywords = (params.keywords as string[] | undefined) ?? [];
  if (keywords.length > 0) {
    logger.info(`关键词：${keywords.join('、')}`);
  }

  // select 单选示例：值为 string
  const mode = params.mode !== undefined ? String(params.mode) : 'normal';
  logger.info(`执行模式：${mode}`);

  // multi-select 示例：值为 string[]
  const namespaces = (params.namespaces as string[] | undefined) ?? [];
  if (namespaces.length > 0) {
    logger.info(`命名空间：${namespaces.join('、')}`);
  }

  const siteInfo = await api.get({
    action: 'query',
    meta: 'siteinfo',
  });

  logger.info(`'''站点名称'''：${siteInfo.query.general.sitename}，''主页地址''：[[${siteInfo.query.general.mainpage}]]`);

  logger.warn("这是一条'''wikitext''检查''日志'''，用于''检查'''各种加粗、斜体'''的复杂情况''");
  logger.error("'''''这段是加粗斜体，'''这段是斜体''；'''''这段是加粗斜体，''这段是加粗'''");
};

export default taskExample;
