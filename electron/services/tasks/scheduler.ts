import { Cron } from 'croner';
import type { TaskConfig } from '@shared/types';
import { runTask } from './runner';
import { TASK_REGISTRY } from './registry';
import type { TaskRunCallbacks } from './types';

/**
 * 任务调度器
 *
 * 实现 cron 调度。生命周期：
 * - 主进程启动时加载 taskConfigs，对启用项注册 cron 任务
 * - 用户在前端修改配置后由 IPC 处理器调用 applyConfigs 全量重建
 * - 应用退出时调用 clear 清理
 */
class TaskScheduler {
  /** 当前已注册的 cron 任务（key -> Cron 实例） */
  private jobs = new Map<string, Cron>();
  /** 推送回调集合（日志、状态、执行记录），由主进程注入 */
  private callbacks: TaskRunCallbacks | null = null;

  /** 设置推送回调集合 */
  setCallbacks(callbacks: TaskRunCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 应用任务配置（全量重建定时器）
   * @param configs 任务配置集合（taskKey -> TaskConfig）
   */
  applyConfigs(configs: Record<string, TaskConfig>): void {
    this.clear();
    for (const [key, config] of Object.entries(configs)) {
      // 跳过已从注册表移除的任务
      if (!TASK_REGISTRY[key]) {
        continue;
      }
      if (config?.enabled && config.cron) {
        this.scheduleTask(key, config.cron);
      }
    }
  }

  /** 调度单个任务 */
  private scheduleTask(key: string, cron: string): void {
    try {
      const job = new Cron(cron, {
        // 捕获任务回调抛出的异常（含 async rejection），记录日志
        catch: (err) => {
          this.callbacks?.sendLog({
            level: 'ERROR',
            taskKey: key,
            message: `任务调度执行异常：${(err as Error).message ?? String(err)}`,
            system: true,
          });
        },
      }, async () => {
        if (this.callbacks) {
          await runTask(key, this.callbacks);
        }
      });
      this.jobs.set(key, job);
    } catch (e) {
      this.callbacks?.sendLog({
        level: 'ERROR',
        taskKey: key,
        message: `调度注册失败：${(e as Error).message ?? String(e)}`,
        system: true,
      });
    }
  }

  /** 清空所有调度 */
  clear(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }
}

/** 任务调度器单例 */
export const scheduler = new TaskScheduler();
