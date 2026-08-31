# 萌娘百科 API 使用说明（面向 AI）

本文档面向在本仓库中编写/维护机器人任务（`electron/tasks/`）的 AI，介绍萌娘百科 API 的用法与本项目的封装。编写任务前建议通读。

> 萌娘百科运行的是 MediaWiki，使用其 [Action API](https://www.mediawiki.org/wiki/API:Main_page)（`/api.php`）。下文所称"API"均指此接口。

## 1. 域名与端点

| 用途 | 域名 | 说明 |
| --- | --- | --- |
| 主站（默认） | `mzh.moegirl.org.cn` | 设置项 `moegirlDomain` 默认值 |
| 主站镜像 | `zh.moegirl.org.cn` | 可在设置中切换 |
| 共享站 | `commons.moegirl.org.cn` | 图片等共享资源，由 `commonsApi` 固定使用 |

端点统一为 `https://${host}/api.php`。

## 2. 项目封装：`MoegirlApi`

定义于 `electron/services/moegirl.ts`。任务通过 `TaskContext` 注入的 `api`（主站）与 `commonsApi`（共享站）使用，**不要自行 new**。

### 2.1 常用方法

| 方法 | 说明 |
| --- | --- |
| `api.get(params)` | GET 请求 |
| `api.post(params)` | POST 请求（任务中最常用） |
| `api.postWithToken(tokenType, params)` | 先取 token 再 POST；自动处理 `badtoken` 刷新。编辑等写操作必须用此方法 |
| `api.getToken(tokenType)` / `refreshToken(...)` | 取/刷新 token（带缓存） |
| `api.fetchCategoryMembers(category, extraParams?)` | 获取分类的全部成员，自动处理 `cmcontinue` 分页 |

### 2.2 请求机制（`request`，`moegirl.ts:142`）

- **默认参数**（`DEFAULT_PARAMS`）：`format=json`、`utf8=1`、`formatversion=2`，自动合并进每次请求。
- **参数序列化**：
  - 数组用 `|` 拼接，如 `titles: ['A','B']` -> `titles=A|B`、`gcmnamespace: '10|14'`。
  - 值为 `false` 的参数会被**丢弃**（用于条件性传参，如 `gcmcontinue: false` 不发送）。
- **HTTP**：POST 时参数放进 `URLSearchParams` body；携带 `User-Agent`（来自设置）与 `credentials: 'include'`（复用账号 session 的 cookie）。
- **超时**：30 秒（`AbortController`）。
- **重试**：按设置 `retryCount`（默认 1）/`retryInterval`（默认 3000ms）重试；`badtoken`、`permissiondenied`、`invalidtitle` 等不可重试错误码立即抛出（`NON_RETRYABLE_ERRORS`）。
- **错误解析**：即使 HTTP 200，若响应体含 `error` 字段也会抛出 `Error(error.info || error.code)`。

## 3. 编辑页面

写操作用 `postWithToken('csrf', ...)`，token 由其自动获取与刷新（见 2.1）。本项目任务均为全量重写报告页：

```ts
const res = await api.postWithToken('csrf', {
  action: 'edit',
  title: pageName,
  text,                 // 新页面 wikitext 全量
  summary: '自动更新列表',
  bot: true,            // 标记为机器人编辑
  tags: 'Bot',          // 应用 Bot 标签
});
if (res.edit?.nochange) {
  // 页面内容与现版本一致，未产生新版本
}
```

## 4. 命名空间

| 编号 | 名称 | 说明 |
| --- | --- | --- |
| 0 | 主 | 普通条目 |
| 2 | User | 用户页 |
| 4 | 萌娘百科 | 项目命名空间（如"萌娘百科:xxx"报告页） |
| 10 | Template | 模板 |
| 14 | Category | 分类 |

判断页面类型常用 `page.ns`：`ns === 14` 为子分类，`ns === 10` 为模板。

## 5. 查询示例：全站页面标题

`list=allpages` 分页遍历全站页面标题，`apcontinue` 分页。

```ts
const pageList = new Set<string>();
let apcontinue: string | false = false;
do {
  const res = await api.post({ action: 'query', list: 'allpages', aplimit: 'max', apcontinue });
  apcontinue = res.continue?.apcontinue || false;
  for (const page of res.query.allpages) pageList.add(page.title);
} while (apcontinue);
```

## 6. 分页与 `continue` 机制

单次请求有数量上限，超出时响应会带 `continue` 对象，需把其中的字段回传到下一次请求，直到响应不再含 `continue`。

### 6.1 单参数分页

大多数查询只有一个分页参数，命名规则是 `<前缀>continue`（如 `allpages` → `apcontinue`、`list=categorymembers` → `cmcontinue`、`generator=categorymembers` → `gcmcontinue`）。从 `res.continue?.<前缀>continue` 读取，回传到下次请求，循环至无 `continue`。完整示例见第 5 节。

### 6.2 多参数分页

某些查询（如 `generator` + `prop` 合并）的 `continue` 可能同时含多个字段。处理方式很简单：**上一轮响应返回了什么 `continue`，下一轮请求就原样带上**，直到响应不再含 `continue`。

```ts
let cont = {};
do {
  const res = await api.post({ ...baseParams, ...cont });
  // 处理 res.query ...
  cont = res.continue || {};
} while (Object.keys(cont).length > 0);
```

## 7. 任务上下文速查

任务函数签名 `TaskHandler = (ctx: TaskContext) => Promise<void>`（`electron/services/tasks/types.ts`），`ctx` 提供：

| 字段 | 说明 |
| --- | --- |
| `api` | 主站 `MoegirlApi` 实例 |
| `commonsApi` | 共享站 `MoegirlApi` 实例（固定 `commons.moegirl.org.cn`） |
| `logger` | 日志接口（`log/info/warn/error`，支持 `[[内链]]`、`'''加粗'''`、`''斜体''` wikitext） |
| `params` | 任务参数（`Record<string, number|string>`，已合并注册表默认值） |
| `signal` | 取消信号，循环中调用 `signal.throwIfAborted()` |
| `sleep(ms)` | 可取消延时，被取消时抛 `AbortError`；替代不可中断的 `setTimeout` |

新增任务：在 `electron/tasks/` 创建文件导出 `TaskHandler`，并在 `electron/services/tasks/registry.ts` 的 `TASK_REGISTRY` 注册元数据（含 `params` 字段定义）。
