import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { electronSimple } from 'vite-plugin-electron/multi-env';
import { notBundle } from 'vite-plugin-electron/plugin';
import checker from 'vite-plugin-checker';
import pkg from './package.json' with { type: 'json' };

const external = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
);

const buildDefines = {
  __APP_NAME__: JSON.stringify(pkg.productName),
  __APP_VERSION__: JSON.stringify(pkg.version),
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
          plugins: [notBundle()],
          options: {
            define: buildDefines,
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rolldownOptions: {
                external,
              },
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rolldownOptions: {
                external,
              },
            },
          },
        },
      }),
    ],
    clearScreen: false,
  };
});
