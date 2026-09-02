/**
 * 网页演示版（GitHub Pages）构建配置
 *
 * 与桌面版 vite.config.ts 的差异：
 * - 不包含 vite-plugin-electron（仅构建渲染进程）
 * - base 固定为仓库 Pages 子路径
 * - 通过 transformIndexHtml 在主入口前注入 mock 安装模块，避免改动共享入口文件
 * 渲染进程在无 preload 环境下由 src/mocks 提供 IPC 模拟实现。
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

/** 与桌面版一致的构建期注入常量 */
const buildDefines = {
  __APP_NAME__: JSON.stringify(pkg.productName),
  __APP_VERSION__: JSON.stringify(pkg.version),
  // 网页演示模式标记：UI 据此隐藏桌面专属功能（如账号添加入口）
  __WEB_DEMO__: 'true',
  // react-draggable 内部读取 process.env.DRAGGABLE_DEBUG，浏览器环境无 process，替换为 false 避免运行时报错
  'process.env.DRAGGABLE_DEBUG': 'false',
};

/** 在主入口脚本之前注入 mock 安装模块（仅网页构建，不改动共享入口文件） */
function webMockInjector() {
  return {
    name: 'install-web-mock',
    // pre 阶段注入的 script 会被纳入 Vite 完整构建管道（打包 + base 路径重写）
    transformIndexHtml: {
      order: 'pre' as const,
      handler() {
        return [{
          tag: 'script',
          attrs: { type: 'module', src: '/src/mocks/install.ts' },
          injectTo: 'body-prepend' as const,
        }];
      },
    },
  };
}

export default defineConfig({
  base: '/bearbot-console/',
  define: buildDefines,
  plugins: [react(), tailwindcss(), webMockInjector()],
  resolve: {
    alias: {
      '@': path.join(import.meta.dirname, 'src'),
      '@shared': path.join(import.meta.dirname, 'shared'),
    },
  },
  build: {
    chunkSizeWarningLimit: 8192,
  },
});
