import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import ErrorBoundary from './components/error-boundary';
import { reportRendererError } from './lib/report-error';

dayjs.locale('zh-cn');

// 全局兜底：未处理的 Promise rejection（如 IPC 调用失败）与运行期未捕获异常，
// 统一记录到日志面板并持久化，避免静默失败。与主进程 uncaughtException/unhandledRejection 兜底对齐。
window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('未处理的 Promise rejection', event.reason);
});
window.addEventListener('error', (event) => {
  reportRendererError('未捕获异常', event.error ?? event.message);
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
