# 任务脚本开发指南

- [快速开始](#快速开始)
  - [文件结构](#文件结构)
  - [最小示例](#最小示例)
- [任务执行上下文](#任务执行上下文)
  - [`api` — 主站 MoegirlApi 实例](#api--主站-moegirlapi-实例)
    - [`get` / `post`](#get--post)
    - [`postWithToken`](#postwithtoken)
    - [`getToken`](#gettoken)
    - [`getPageSource`](#getpagesource)
    - [`editPage`](#editpage)
    - [`fetchCategoryMembers`](#fetchcategorymembers)
    - [`fetchAllPages`](#fetchallpages)
  - [`commonsApi` — 共享站 MoegirlApi 实例](#commonsapi--共享站-moegirlapi-实例)
  - [`logger` — 日志输出](#logger--日志输出)
  - [`user` — 用户信息](#user--用户信息)
  - [`signal` — 任务中断](#signal--任务中断)
    - [`signal.throwIfAborted()` — 手动中断点](#signalthrowifaborted--手动中断点)
    - [中断其他接口请求](#中断其他接口请求)
  - [`sleep()` — 可取消的延时](#sleep--可取消的延时)
  - [`params` — 任务参数](#params--任务参数)
- [注册任务](#注册任务)
  - [任务参数](#任务参数)
    - [参数字段类型](#参数字段类型)
    - [TaskParamField 完整字段](#taskparamfield-完整字段)
- [迁移检查清单](#迁移检查清单)


## 快速开始

### 文件结构

```
electron/tasks/          ← 任务脚本目录，建议每个任务一个文件或目录
├── task-example.ts
└── your-task.ts         ← 新任务脚本文件
electron/services/tasks/
├── registry.ts          ← 任务注册表，新增任务需在此添加
```

### 最小示例

**编写任务脚本**

```typescript
// electron/tasks/my-task.ts
import type { TaskHandler } from '../services/tasks/types';

const myTask: TaskHandler = async ({ api, logger }) => {
  const data = await api.post({
    action: 'query',
    meta: 'siteinfo',
  });

  logger.info(`站点名称：${data.query.general.sitename}`);
};

export default myTask;
```

**添加注册表**

在 [registry.ts](../electron/services/tasks/registry.ts) 中添加

```typescript
import myTaskHandler from '../../tasks/my-task';

export const TASK_REGISTRY: Record<string, TaskEntry> = {
  'my-task': {
    defaultName: '我的任务',
    defaultDescription: '任务描述，显示在界面卡片上',
    handler: myTaskHandler,
  },
};
```

完成这两步后，启动开发模式或构建即可在界面看到新任务。

## 任务执行上下文

任务函数接收一个 [TaskContext 对象](../electron/services/tasks/types.ts#L28)，包含以下字段。推荐使用解构赋值按需提取字段：

```typescript
const myTask: TaskHandler = async ({ api, commonsApi, logger, user, params, signal, sleep }) => {
  // 只解构需要的字段，未使用的字段无需引入
};
```

`TaskContext` 包含以下字段：

### `api` — 主站 MoegirlApi 实例

`get`、`post`等方法和 MediaWiki 网页提供的 `mw.Api` 基本相同，除此之外提供一些封装好的方法，如获取页面源代码、编辑页面等。

> api 发起的请求默认携带 `formatversion=2`（和[API沙盒](https://zh.moegirl.org.cn/Special:API沙盒)一致），迁移时需要注意响应体可能不同，或者自行修改 [MoegirlApi 源代码](../electron/services/moegirl.ts)

提供以下方法：

#### `get` / `post`

发起 GET / POST 请求，第一个参数为 MediaWiki API 参数对象：

```typescript
const data = await api.get({
  action: 'query',
  titles: '页面名',
});
```

第二个参数可传入选项对象，支持 `retries` 重试次数与 `timeout`请求超时毫秒数：

```typescript
// 不重试
const data = await api.post({ action: 'query', ... }, { retries: 0 });

// 重试 3 次，超时 60 秒
const data = await api.get({ action: 'query', ... }, { retries: 3, timeout: 60000 });
```

> 代码里的数值覆盖应用设置，不填写则使用应用设置。

#### `postWithToken`

携带 token 发起 POST 请求，自动处理 token 获取和 badtoken 刷新：

```typescript
const data = await api.postWithToken('csrf', {
  action: 'edit',
  title: '页面名',
  text: '新内容',
  summary: '编辑摘要',
  bot: true,
  tags: 'Bot',
});
```

#### `getToken`

获取指定类型的 token（`csrf`、`watch`、`rollback` 等），含缓存功能，失效或缺失时发起请求重新获取。

通常直接用 `postWithToken` 即可，仅在需要单独获取 token 时使用：

```typescript
const token: string = await api.getToken('csrf');
```

#### `getPageSource`

获取指定页面的源代码：

```typescript
const source: string = await api.getPageSource('页面名');
```

#### `editPage`

编辑页面并保存：

```typescript
await api.editPage('页面名', '新的页面全文', '编辑摘要');

// 需要单独控制重试/超时时传入第四个参数（同 get/post 的选项）
await api.editPage('页面名', text, '编辑摘要', { timeout: 60000 });
```

- 请求默认携带 `bot: true` 与 `tags: 'Bot'`
- 保存过程自动输出日志，任务脚本中无需手动记录
- MediaWiki 在编辑被拦截或权限不足时返回 `result: "Failure"` 而不通过 `error` 字段报错，`editPage` 已做校验，此类失败会抛出携带 result 的错误并由框架记录

#### `fetchCategoryMembers`

获取指定分类的全部成员，自动处理 `cmcontinue` 分页：

```typescript
const members = await api.fetchCategoryMembers('Category:分类名');
for (const member of members) {
  logger.info(member.title);
}

// 只获取模板和子分类，并同时返回成员类型
const filteredMembers = await api.fetchCategoryMembers<{ title: string; type: string }>(
  'Category:分类名',
  {
    cmnamespace: '10|14',
    cmtype: 'page|subcat',
    cmprop: 'title|type',
  },
);
```

第二个参数用于传入 `cmnamespace`、`cmtype`、`cmprop`、`cmsort` 等 `list=categorymembers` 参数。
`action`、`list`、`cmtitle`、`cmlimit` 与 `cmcontinue` 由方法统一控制，传入同名参数不会覆盖内部值。

#### `fetchAllPages`

获取全站页面标题列表（Set），支持传入额外查询参数：

```typescript
const allPages: Set<string> = await api.fetchAllPages();
// 排除重定向
const allPages: Set<string> = await api.fetchAllPages({ apfilterredir: 'nonredirects' });
```

### `commonsApi` — 共享站 MoegirlApi 实例

与 [api](#api--主站-moegirlapi-实例) 相同。

```typescript
const commonsData = await commonsApi.get({
  action: 'query',
  meta: 'siteinfo',
});
```

### `logger` — 日志输出

对应 `console.log` / `console.warn` / `console.error`，调用本对象方法记录的日志会显示到界面右侧日志面板。

- 支持 wikitext 的 `[[内链]]、'''加粗'''、''斜体''` 语法。
- 参数2的内容在面板中渲染时会进入折叠信息，用于记录大段信息，如完整接口响应等。

```typescript
logger.log('一般信息');   // 等同于 logger.info
logger.info('已更新[[页面名]]');
logger.warn("这是一条'''警告'''信息");
logger.error('错误信息');
logger.error('错误信息', JSON.stringify({ foo:"bar" }));
```

> 框架会在任务启动和结束时自动输出系统日志（`开始执行任务【名称】`、`【名称】执行完成`、`【名称】执行失败`、`【名称】已手动停止`），任务脚本中无需手动记录起止。
>
> 萌百 API 请求失败时，框架会自动记录请求参数与响应详情（界面中可折叠查看），任务脚本中通常无需手动打印错误堆栈。

### `user` — 用户信息

类似网页提供的`mw.user`，提供带缓存的用户权限和用户组查询，首次调用时通过 `list=users` 接口（`usprop=groups|rights`）查询当前账号的用户组与权限，后续直接返回缓存。

```typescript
// 获取权限列表
const rights = await user.getRights();
const hasHightLimits = rights.includes('apihighlimits');

// 获取用户组列表
const groups = await user.getGroups();
const isPatroller = groups.includes('patroller');
```

可用于根据当前账号权限动态调整行为的场景，例如根据 `apihighlimits` 权限决定批量请求大小。

### `signal` — 任务中断

`api` 和 `sleep` 已自动注入 signal 用于中止，大多数任务通常不需要手动添加中断点，仅在自定义请求等场景需要自行添加：

#### `signal.throwIfAborted()` — 手动中断点

在需要支持中止的循环或关键位置插入，手动停止时抛出 `AbortError`，框架会捕获并标记任务为“已停止”状态：

```typescript
do {
  signal.throwIfAborted();
  // ...执行操作
} while (hasMore);
```

#### 中断其他接口请求

调用非萌娘百科的外部接口时需使用原生 `fetch`，此时不会自动响应中止，需手动把 `signal` 传入请求参数。`signal` 是标准 [AbortSignal](https://developer.mozilla.org/zh-CN/docs/Web/API/AbortSignal)，手动停止时在飞的请求会立即中断并抛出 `AbortError`，框架捕获后标记任务为“已停止”：

```typescript
const res = await fetch('https://example.com/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ foo: 'bar' }),
  signal, // 传入 signal，手动停止时立即中断请求
});
if (!res.ok) {
  throw new Error(`HTTP ${res.status}`);
}
const data = await res.json();
```

> 支持 `AbortSignal` 的请求库（如 `axios`、`undici`）均可按各自方式传入 `signal`，效果相同。

### `sleep()` — 可取消的延时

替代 `setTimeout`，等待期间也能响应手动停止，立即抛出 `AbortError`：

```typescript
await sleep(1000); // 等待 1 秒，可被中断
```

避免直接使用 `setTimeout`，以免出现任务执行结束判定错误及打断失败。

### `params` — 任务参数

在注册表中[声明参数字段](#任务参数)后，用户可通过界面输入，在任务函数中通过 `ctx.params` 读取。值已合并注册表默认值与用户输入。

```typescript
// 注册表中声明 params 后，任务函数中读取
const myTask: TaskHandler = async ({ params, logger }) => {
  const title = params.title;
  logger.info(`标题：${title}`)
};
```

## 注册任务

在 [registry.ts](../electron/services/tasks/registry.ts) 中：

1. 导入任务函数
2. 在 `TASK_REGISTRY` 中添加一项

```typescript
import myTaskHandler from '../../tasks/my-task';

// 在 TASK_REGISTRY 中添加
'my-task': {
  defaultName: '任务显示名称',
  defaultDescription: '任务描述（可选）',
  handler: myTaskHandler,
},
```

| 字段                 | 说明                                                |
| -------------------- | --------------------------------------------------- |
| key（对象键）        | 任务唯一标识，不可变，如 `'my-task'`                |
| `defaultName`        | 界面显示的默认名称，用户可自定义覆盖                |
| `defaultDescription` | 界面显示的默认描述，用户可自定义覆盖（可选）        |
| `params`             | 任务参数字段定义（可选，详见[任务参数](#任务参数)） |
| `handler`            | 任务执行函数                                        |

注册完成后，启动应用进入任务管理界面，点击任务的设置按钮配置执行计划（cron 表达式），然后开启任务的启用开关，任务即会按计划自动执行。

同一任务正在执行时，新的触发会被自动忽略（防重入）。任务自然结束（成功/失败）时，若开启了"任务完成通知"设置，会发送系统桌面通知（手动停止不通知）。

### 任务参数

任务支持通过 `params` 字段声明可配置参数，任务管理界面会根据声明动态生成输入框。

在注册表中添加 `params` 数组：

```typescript
'my-task': {
  defaultName: '我的任务',
  defaultDescription: '任务描述',
  params: [
    {
      key: 'interval',
      label: '请求间隔(ms)',
      type: 'number',
      default: 500,
      help: '递归请求时的等待时间（毫秒）',
    },
    {
      key: 'mode',
      label: '执行模式',
      type: 'select',
      default: 'normal',
      options: [
        { label: '普通', value: 'normal' },
        { label: '详细', value: 'verbose' },
      ],
    },
  ],
  handler: myTaskHandler,
},
```

#### 参数字段类型

| type           | 说明                           | ctx.params 中的值类型 |
| -------------- | ------------------------------ | --------------------- |
| `string`       | 单行文本输入                   | `string`              |
| `number`       | 数字输入                       | `number`              |
| `text`         | 多行文本输入                   | `string`              |
| `multi-string` | 多值文本（标签输入，回车添加） | `string[]`            |
| `select`       | 下拉选择（单选）               | `string`              |
| `multi-select` | 下拉选择（多选）               | `string[]`            |

#### TaskParamField 完整字段

| 字段          | 必填 | 说明                                                                     |
| ------------- | ---- | ------------------------------------------------------------------------ |
| `key`         | 是   | 参数键名，对应 `ctx.params` 中的键                                       |
| `label`       | 是   | 界面显示标签                                                             |
| `type`        | 是   | 字段类型（见上表）                                                       |
| `default`     | 否   | 默认值，用户未输入时使用；`multi-string` 和 `multi-select` 为 `string[]` |
| `placeholder` | 否   | 占位提示文本                                                             |
| `required`    | 否   | 是否必填（默认 `false`）                                                 |
| `help`        | 否   | 帮助提示，鼠标悬浮显示                                                   |
| `options`     | 否   | `select` 与 `multi-select` 类型的可选项                                  |

> 任务参数配置目前为明文存储，涉及敏感内容请自行处理加密。

## 迁移检查清单

- [ ] 将函数签名改为 `(ctx: TaskContext) => Promise<void>` 并从 ctx 中解构所需字段
- [ ] 移除创建 `mw.Api` 实例、登录相关代码
- [ ] 将 `console.log` / `console.warn` / `console.error` 替换为 `logger.info` / `logger.warn` / `logger.error`
- [ ] 在 fetch 请求中添加 `signal`
- [ ] 将原有的等待函数替换为 `sleep`
- [ ] 用 `export default` 导出任务函数
- [ ] 在 `registry.ts` 中注册任务
