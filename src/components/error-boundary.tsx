import type { ReactNode } from 'react';
import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { reportRendererError } from '@/lib/report-error';

interface ErrorBoundaryProps {
  children: ReactNode;
}

/**
 * 兜底界面
 *
 * 使用原生元素与内联样式，不依赖 antd / ConfigProvider，
 * 确保即使主题或组件库自身出错时仍可正常显示。
 */
function Fallback({ error }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        height: '100vh',
        padding: 24,
        textAlign: 'center',
        color: '#333',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600 }}>界面出现错误</div>
      <div style={{ maxWidth: 480, color: '#888', wordBreak: 'break-all' }}>
        {message || '未知错误'}
      </div>
      <button
        type='button'
        onClick={() => window.location.reload()}
        style={{
          padding: '6px 20px',
          fontSize: 14,
          color: '#fff',
          background: '#1677ff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        重新加载
      </button>
    </div>
  );
}

/**
 * 应用级 React 错误边界
 *
 * 基于 react-error-boundary 封装：捕获渲染阶段抛出的异常，避免单个组件出错导致整棵组件树卸载成白屏。
 * 错误经 {@link reportRendererError} 记录（console + 日志面板 + 持久化），并渲染 {@link Fallback} 兜底界面。
 */
export default function ErrorBoundary({ children }: ErrorBoundaryProps) {
  return (
    <ReactErrorBoundary
      FallbackComponent={Fallback}
      onError={(error, info) => reportRendererError('React 渲染错误', error, info.componentStack ?? undefined)}
    >
      {children}
    </ReactErrorBoundary>
  );
}
