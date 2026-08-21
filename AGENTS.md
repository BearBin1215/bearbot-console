# AGENTS.md

## 项目概述

基于 electron 的萌娘百科机器人控制台，用于执行萌娘百科机器人脚本，支持设置执行周期和时间。

面向中文用户，对话、思考推理、输出文档都使用中文。

## 技术栈

- **运行时**: Electron 43 + Node.js 24
- **前端**: React 19 + TypeScript 6
- **UI 库**: Ant Design 6 + TailwindCSS 4
- **状态管理**: Zustand
- **构建工具**: Vite 8 + vite-plugin-electron + electron-builder
- **包管理器**: pnpm
- **测试**: Vitest

## 常用命令

```bash
pnpm dev        # 启动开发服务器（含 Electron 主进程热重载）
pnpm build      # 构建生产版本（vite build + electron-builder）
pnpm typecheck  # TypeScript 类型检查
pnpm lint       # ESLint 检查
pnpm lint:fix   # ESLint 自动修复
pnpm test       # 运行单元测试（vitest watch）
pnpm test:run   # 运行单元测试（单次）
```

## 项目结构

仅总体结构

```
bearbot-console/
├── docs/                   # 文档（需求规格说明书）
├── electron/               # 主进程（窗口管理、托盘、IPC、持久化存储）
│   ├── main/
│   ├── preload/
│   ├── services/
│   │   └── tasks/          # 任务调度、执行、注册
│   └── tasks/              # 任务脚本（每个任务一个文件或目录）
├── src/                    # 渲染进程（React + Ant Design）
│   ├── components/         # React 组件（按功能分子目录）
│   ├── lib/                # 工具函数、类型定义、常量映射
│   └── stores/             # Zustand 状态管理
├── shared/                 # 共享内容（类型等）
├── test/                   # 测试脚本目录
│   ├── main/               # 主进程测试
│   ├── renderer/           # 渲染进程测试
│   └── tasks/              # 任务脚本测试
├── electron-builder.json
├── vite.config.ts
└── tsconfig.json / tsconfig.node.json
```

## 架构

### 进程模型

- **主进程** (`electron/main/`): Node.js 环境，负责窗口管理、系统托盘、任务调度（`node-schedule` 触发）、文件 I/O、本地存储（`electron-store`）、**萌娘百科 API 请求和任务脚本执行**。
- **Preload** (`electron/preload/`): 通过 `contextBridge` 向渲染进程暴露 `ipcRenderer` 的安全 API。
- **渲染进程** (`src/`): React 应用，负责 UI 渲染、用户交互。通过 IPC 调用主进程读取设置、执行任务等。

### IPC 通信

渲染进程通过 `window.ipcRenderer.invoke(channel, ...args)` 调用主进程的 `ipcMain.handle` 处理器，获取设置、读取日志等。主进程通过 `webContents.send()` 通知渲染进程执行任务。

### 任务系统

任务脚本放在 `electron/tasks/` 目录下，每个任务一个文件/目录，导出任务执行函数。

新增任务步骤：
1. 在 `electron/tasks/` 创建任务文件，导出执行函数
2. 在 `electron/services/tasks/registry.ts` 的 `TASK_REGISTRY` 中注册元数据和执行函数

主进程的 `node-schedule` 调度器在触发时间到达时执行任务，日志通过 `task:log` 通道推送到渲染进程展示。任务调度配置持久化到主进程的 `electron-store`。

### 数据存储

使用 `electron-store` 进行持久化存储，包括：
- 应用设置（界面设置、萌娘百科设置等）
- 用户信息（用户组、权限）
- 任务调度配置（`cron`、`enabled`、`overrides`，可持久化）

Cookie 由原生 session cookie store 管理，在多账号登录的情况下按账号存储。

## 代码规范

- 代码风格遵循 ESLint 配置，见 `eslint.config.ts`
- 每个函数都应有对应的jsdoc注释；复杂逻辑需要描述逻辑，优先放在具体语句附近而非函数顶部，顶部只放功能概述
- 会反复多次使用的变量，通用组件、Store 接口的每个属性都应有对应的jsdoc注释
- 代码修改后，不要注释说明这里曾经是什么样，只说明最新代码（除非要提醒开发者不要使用废弃方案）
- 每次涉及ts的代码修改后运行 `pnpm typecheck` 和 `pnpm lint`
- 修改或新增功能时，如有必要可以使用现有的成熟库，不要自造轮子
- 禁止导入重导出（`export { foo } from 'bar'`）

## 代码审查约定

- 通常情况下，本应用会较长时间处于后台运行状态（最小化到托盘），因此需要考虑后台运行时的内存占用、恢复窗口时的界面显示
- 未实现的需求无需处理，仅审查已实现代码的质量
- 硬编码但未关联实际业务的数据为MOCK占位数据，功能尚未实现，无需处理
- 实际生产环境中，全站条目总量约为220000，涉及遍历全站标题等功能时以250000为标准估算性能压力
