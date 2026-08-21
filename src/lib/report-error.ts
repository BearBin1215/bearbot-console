import dayjs from 'dayjs';
import { useLogStore } from '@/stores/log-store';

/**
 * 上报渲染进程错误（对齐主进程 logFatalError）
 *
 * 三处落点保持与主进程一致：
 * - console.error：开发者工具可见
 * - 内存日志面板：即时呈现给用户（白屏兜底重载前仍可见）
 * - 主进程持久化：通过 log:renderer-error 复用任务日志链路写入日志文件
 *
 * 本函数自身吞掉所有异常，避免在错误处理路径上再次抛错形成循环。
 *
 * @param source 错误来源描述（如「未捕获异常」「React 渲染错误」）
 * @param err 原始错误
 * @param extraDetail 附加诊断信息（如 React 组件栈），追加到 detail
 */
export function reportRendererError(source: string, err: unknown, extraDetail?: string): void {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const detail = [stack, extraDetail].filter(Boolean).join('\n\n') || undefined;
    const fullMessage = `${source}：${message}`;

    // 即时呈现到日志面板（内存），白屏兜底重载前用户仍能看到
    useLogStore.getState().addLog({
      level: 'ERROR',
      taskKey: '__system__',
      message: fullMessage,
      system: true,
      time: dayjs(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      ...(detail ? { detail } : {}),
    });

    // 持久化到日志文件：复用主进程任务日志链路（失败静默，避免错误处理再抛错）
    void window.ipcRenderer
      .invoke('log:renderer-error', { message: fullMessage, detail })
      .catch(() => { /* 上报失败无法再上报，忽略 */ });
  } catch {
    // 错误处理路径自身出错时静默，避免循环
  }
}
