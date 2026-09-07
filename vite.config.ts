import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { electronSimple } from 'vite-plugin-electron/multi-env';
import checker from 'vite-plugin-checker';
import pkg from './package.json' with { type: 'json' };

/**
 * 主进程运行时依赖（dependencies）的 external 匹配
 *
 * 依赖包及其子路径（如 zod/mini）均保持 external，运行时由 electron-builder 打入 asar 的 node_modules 提供。
 * rolldown 的 external 不支持函数形式（binding 仅接受字符串/RegExp），且字符串数组仅精确匹配裸包名无法覆盖子路径，故用 RegExp。
 * npm 包名不含正则特殊字符（`-`/`_`/`.`/`@`/`/`），`.` 需转义。
 */
const externalDeps = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
);
const external = externalDeps.map((name) => new RegExp(`^${name.replaceAll('.', '\\.')}(?:/.+)?$`));

const buildDefines = {
  __APP_NAME__: JSON.stringify(pkg.productName),
  __APP_VERSION__: JSON.stringify(pkg.version),
};

/**
 * electron 环境（main/preload）专用的路径别名
 *
 * vite-plugin-electron 侧为独立构建（configFile: false），不会继承根配置的 resolve.alias，
 * 必须在各自的 rolldownOptions.resolve 中单独声明
 */
const electronResolve = {
  alias: {
    '@shared': path.join(import.meta.dirname, 'shared'),
  },
};

export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true });

  const isServe = command === 'serve';
  const isBuild = command === 'build';
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;

  return {
    define: {
      ...buildDefines,
      // react-draggable 内部读取 process.env.DRAGGABLE_DEBUG，浏览器环境无 process，替换为 false 避免运行时报错
      'process.env.DRAGGABLE_DEBUG': 'false',
    },
    resolve: {
      alias: {
        '@': path.join(import.meta.dirname, 'src'),
        '@shared': path.join(import.meta.dirname, 'shared'),
      },
    },
    build: {
      chunkSizeWarningLimit: 8192,
    },
    plugins: [
      react(),
      tailwindcss(),
      isServe && checker({ typescript: true }),
      electronSimple({
        main: {
          input: 'electron/main/index.ts',
          options: {
            define: buildDefines,
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rolldownOptions: {
                external,
                resolve: electronResolve,
              },
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          bundleDeps: true,
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rolldownOptions: {
                external: ['electron'],
                resolve: electronResolve,
              },
            },
          },
        },
      }),
    ],
    clearScreen: false,
  };
});
