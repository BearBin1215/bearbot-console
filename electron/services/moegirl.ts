/**
 * 萌娘百科 API 请求客户端
 *
 * 封装与萌娘百科的 HTTP 交互
 *
 * 本模块提供：
 * - {@link MoegirlApi} 类：提供类似`mw.Api()`类的请求方法，按账号隔离 cookie 和 token 缓存。封装 getPageSource 等方法供调用
 * - {@link MoegirlRequestError} 类：结构化请求错误，携带请求/响应详情供日志诊断
 * - {@link abortSignalStorage}：AsyncLocalStorage，供 runner 注入任务取消信号，使请求层支持响应手动停止
 * - {@link loggerStorage}：AsyncLocalStorage，供 runner 注入任务日志接口，使内部方法无需显式传入 logger
 * - 可复用类型声明
 *
 * 上层模块（accounts、runner、tasks）通过本模块的 API 实例发起萌娘百科请求，不直接使用 Electron session.fetch。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Session } from 'electron';
import { getAllSettings } from './store';
import type { TaskLogger } from './tasks/types';
import type {
  ActionRequest,
  ApiQueryAllpagesParams,
  ApiQueryCategorymembersParams,
  ApiRawParams,
  ClientToken,
  QueryRequest,
} from 'types-mediawiki-params';
import type {
  ApiEditResponse,
  ApiQueryResponse,
  QueryPage,
} from 'types-mediawiki-response';

/** token 类型 */
type TokenType = 'createaccount' | 'csrf' | 'login' | 'patrol' | 'rollback' | 'userrights' | 'watch';

interface RequestOptions {
  /** 重试次数（默认使用应用设置中的值） */
  retries?: number;
  /** 请求超时时间（毫秒，默认 30000） */
  timeout?: number;
}

/**
 * 萌娘百科 API 请求参数（宽松类型）
 *
 * 值域取 types-mediawiki-params 的 {@link ApiRawParams}：允许任意参数名（含未建模的扩展参数），
 * 但值只接受 API 可序列化的标量与同类数组，避免误传对象、null 等无法编码的值。
 * 调用点可进一步用 `satisfies QueryRequest<...>` / `satisfies ClientToken<ActionRequest>` 校验模块与参数名
 */
type ApiParams = { action: string } & ApiRawParams;

/** 请求默认携带参数 */
const DEFAULT_PARAMS: ApiRawParams = {
  format: 'json',
  utf8: 1,
  formatversion: 2,
};

/**
 * 当前请求作用域的取消信号存储
 *
 * 由调用方（如 runner）在执行任务前通过 run 注入 AbortSignal，
 * 供 {@link MoegirlApi} 的内部方法读取，用于手动停止时立即中断在飞的萌娘百科请求
 */
export const abortSignalStorage = new AsyncLocalStorage<AbortSignal>();

/**
 * 当前任务作用域的日志接口存储
 *
 * 由 runner 在执行任务前通过 run 注入该任务的 logger，
 * 供 {@link MoegirlApi} 的内部方法读取，用于输出保存进度与结果
 */
export const loggerStorage = new AsyncLocalStorage<TaskLogger>();

// #region 全局请求节流
//
// 保证任意两次请求放行的时间间隔不小于设置中的 minRequestInterval，
// 所有 MoegirlApi 实例共享（跨账号、跨任务），避免高频请求出错。
// 采用 Promise 链串行放行：请求本身仍可并发，仅错开发起时刻。

/** 节流链尾，下一次请求需等其 resolve 后再放行 */
let throttleChain: Promise<void> = Promise.resolve();
/** 下一次允许放行的最早时间戳（毫秒） */
let throttleNextAvailable = 0;

/**
 * 获取一个请求放行槽
 *
 * 等待至与上一次放行间隔满足设置值后 resolve；signal 触发时立即 resolve（被取消的请求不占用配额，也不更新下次可用时间）。
 * minRequestInterval 为 0 时直接放行，不做节流。
 */
function acquireThrottleSlot(signal?: AbortSignal): Promise<void> {
  const interval = getAllSettings().minRequestInterval;
  if (interval <= 0) {
    return Promise.resolve();
  }
  const result = throttleChain.then(async () => {
    const wait = Math.max(0, throttleNextAvailable - Date.now());
    if (wait > 0 && !signal?.aborted) {
      // timers/promises 在完成或中止时都会自动清理定时器与 abort 监听器
      await sleep(wait, undefined, { signal }).catch((error: unknown) => {
        if (!signal?.aborted) {
          throw error;
        }
      });
    }
    // 被取消的请求不占用配额
    if (!signal?.aborted) {
      throttleNextAvailable = Date.now() + interval;
    }
  });
  // 链尾不因 rejection 断裂，保证后续请求仍可排队
  throttleChain = result.then(() => undefined, () => undefined);
  return result;
}

// #endregion

/**
 * 仅含标题的 MediaWiki 列表元素
 *
 * `redirects` / `links` 等 prop 返回的列表项至少包含 `title`，此类型描述该最小公共结构，供多个任务复用。
 */
export interface TitleEntry {
  /** 页面或链接标题 */
  title: string;
}


// #region 错误处理

/** 不执行重试的 MediaWiki 错误码 */
const NON_RETRYABLE_ERRORS = [
  'badtoken',
  'badprop',
  'permissiondenied',
  'mustbeloggedin',
  'not-need-token',
  'invalidparam',
  'invalidtitle',
  'nosuchpage',
];

/** API 请求失败时的请求、响应详情 */
export interface RequestErrorDetail {
  /** HTTP 方法 */
  method: string;
  /** 请求参数 */
  requestParams: Record<string, string>;
  /** HTTP 状态码。无响应时为 undefined，如网络/超时错误 */
  status?: number;
  /** 响应体。无响应时为 undefined */
  responseBody?: string;
  /** 请求超时时间（毫秒） */
  timeout: number;
}

/** 结构化的萌娘百科 API 请求错误 */
export class MoegirlRequestError extends Error {
  /** 请求/响应详情 */
  readonly detail: RequestErrorDetail;

  /**
   * @param error 原始错误
   * @param action 请求的 action 参数
   * @param attempt 已尝试次数
   * @param detail 请求体与响应体等详情，供调用方按需记录
   */
  constructor(error: Error, action: string, attempt: number, detail: RequestErrorDetail) {
    const isTimeout = error.name === 'AbortError' || /aborted/i.test(error.message);
    const parts = [`${detail.method} 请求失败`, `action=${action}`];
    parts.push(isTimeout ? `请求超时（${detail.timeout / 1000}s）` : error.message);
    if (attempt > 0) {
      parts.push(`已重试${attempt}次`);
    }
    super(parts.join('，'), { cause: error });
    this.name = 'MoegirlRequestError';
    this.detail = detail;
  }
}

// #endregion


// #region MoegirlApi类

/**
 * 萌娘百科 API 客户端
 *
 * 每个账号绑定各自独立实例：构造时注入该账号的 `session` 与账号级 `tokenCache`。
 * 发起请求走 `session.fetch`，自动复用该 session 的 cookie jar，登录写入的 cookie 与后续请求共享，无需手动同步。
 *
 * 主站每次请求时默认读取应用设置中的 moegirlDomain（主站 mzh/zh），传入 hostOverride 可固定域名（如共享站）
 */
export class MoegirlApi {
  /** token 缓存，跨任务共享、账号间隔离 */
  readonly tokens = new Map<string, string>();

  constructor(
    /** 该账号专属的 Electron session（分区），承载 cookie jar */
    readonly session: Session,
    /** 固定域名（可选，未传则在请求时读取应用设置） */
    private readonly hostOverride?: string,
  ) { }

  /** 请求地址：传入 hostOverride 时固定域名，否则从应用设置动态获取 */
  private get url() {
    const host = this.hostOverride ?? getAllSettings().moegirlDomain;
    return `https://${host}/api.php`;
  }

  /** 发起 GET 请求 */
  get<T = Record<string, any>>(params: ApiParams, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', params, options);
  }

  /** 发起 POST 请求 */
  post<T = Record<string, any>>(params: ApiParams, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', params, options);
  }

  /**
   * 获取指定页面的源代码
   * @param title 页面标题
   */
  async getPageSource(title: string): Promise<string> {
    const res = await this.post<ApiQueryResponse>({
      action: 'query',
      prop: 'revisions',
      titles: title,
      rvprop: 'content',
      rvslots: 'main',
    } satisfies QueryRequest<'revisions'>);
    const [pageData] = (res.query.pages ?? []) as QueryPage<'revisions'>[];
    if (pageData?.missing) {
      throw new Error(`页面[[${title}]]不存在`);
    }
    // 正文可能被修订删除或未返回，content 为可选，取不到时视为失败
    const content = pageData?.revisions?.[0]?.slots?.main?.content;
    if (content === undefined) {
      throw new Error(`获取页面[[${title}]]源代码失败`);
    }
    return content;
  }

  /**
   * 获取指定分类的全部成员
   *
   * 自动使用 `cmcontinue` 完成分页。额外参数用于传入 `cmnamespace`、`cmtype`、`cmsort` 等
   * `list=categorymembers` 查询参数（多值参数须用数组，如 `cmnamespace: [10, 14]`）；
   * `action`、`list`、`cmtitle`、`cmpageid`、`cmlimit` 与 `cmcontinue` 由本方法统一控制。
   *
   * @param category 分类标题（含 Category: 前缀）
   * @param extraParams 额外的 categorymembers 查询参数
   * @returns 分类成员列表
   */
  async fetchCategoryMembers<T = TitleEntry>(
    category: string,
    extraParams?: Omit<ApiQueryCategorymembersParams, 'cmtitle' | 'cmpageid' | 'cmlimit' | 'cmcontinue'>,
  ): Promise<T[]> {
    const members: T[] = [];
    let cmcontinue: string | false = false;
    do {
      const response: ApiQueryResponse = await this.post<ApiQueryResponse>({
        ...extraParams,
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmlimit: 'max',
        ...(cmcontinue ? { cmcontinue } : {}),
      } satisfies QueryRequest<never, 'categorymembers'>);
      cmcontinue = response.continue?.cmcontinue || false;
      members.push(...(response.query.categorymembers ?? []) as unknown as T[]);
    } while (cmcontinue);
    return members;
  }

  /**
   * 获取全站页面标题列表
   * @param extraParams 额外的查询参数（如 `{ apfilterredir: 'nonredirects' }` 排除重定向）
   * @returns 页面标题集合（Set）
   */
  async fetchAllPages(extraParams?: Omit<ApiQueryAllpagesParams, 'aplimit' | 'apcontinue'>) {
    const pageList = new Set<string>();
    let apcontinue: string | false = false;
    do {
      const allPages: ApiQueryResponse = await this.post<ApiQueryResponse>({
        action: 'query',
        list: 'allpages',
        aplimit: 'max',
        ...(apcontinue ? { apcontinue } : {}),
        ...extraParams,
      } satisfies QueryRequest<never, 'allpages'>);
      apcontinue = allPages.continue?.apcontinue || false;
      for (const page of allPages.query.allpages ?? []) {
        pageList.add(page.title);
      }
    } while (apcontinue);
    return pageList;
  }

  /** 获取指定类型的 token，优先使用缓存 */
  async getToken(tokenType: TokenType): Promise<string> {
    const cached = this.tokens.get(tokenType);
    if (cached) {
      return cached;
    }
    try {
      const data = await this.get<ApiQueryResponse>({
        action: 'query',
        meta: 'tokens',
        type: tokenType,
      } satisfies QueryRequest<never, never, 'tokens'>);
      const token = data.query.tokens?.[`${tokenType}token`];
      if (!token) {
        throw new Error(`获取 ${tokenType} Token 失败`);
      }
      this.tokens.set(tokenType, token);
      return token;
    } catch (e) {
      this.tokens.delete(tokenType);
      throw e;
    }
  }

  /** 携带 token 发起 POST 请求 */
  async postWithToken<T = Record<string, any>>(
    tokenType: TokenType,
    params: ApiParams,
    options?: RequestOptions,
  ): Promise<T> {
    let token = await this.getToken(tokenType);
    try {
      return await this.post<T>({ ...params, token }, options);
    } catch (error) {
      const msg = (error as Error).message ?? '';
      // 自动处理 badtoken 刷新
      if (msg.includes('badtoken')) {
        this.tokens.delete(tokenType);
        token = await this.getToken(tokenType);
        return this.post<T>({ ...params, token }, options);
      }
      throw error;
    }
  }

  /**
   * 编辑页面并校验结果
   *
   * @param title 目标页面标题
   * @param text 页面全文（整体覆盖）
   * @param summary 编辑摘要
   * @param options 可选请求配置（如超时），透传给 {@link postWithToken}
   */
  async editPage(
    title: string,
    text: string,
    summary: string,
    options?: RequestOptions,
  ): Promise<void> {
    const logger = loggerStorage.getStore();
    logger?.info(`正在保存到[[${title}]]`);
    const res = await this.postWithToken<ApiEditResponse>('csrf', {
      action: 'edit',
      title,
      text,
      summary,
      bot: true,
      tags: 'Bot',
    } satisfies ClientToken<ActionRequest>, options);
    // 校验编辑结果：MediaWiki 在拦截/权限不足时返回 result: "Failure" 但不通过 error 字段抛错
    if (res.edit.result !== 'Success') {
      throw new Error(`编辑[[${title}]]失败：${res.edit.result ?? '未知结果'}`);
    }
    if (res.edit.nochange) {
      logger?.info('页面无变化');
    } else {
      logger?.info('保存成功');
    }
  }

  /** 清除该账号的 token 缓存 */
  clearTokenCache() {
    this.tokens.clear();
  }

  /** 判断错误是否可重试 */
  private isRetryable(error: Error): boolean {
    const msg = error.message ?? '';
    return !NON_RETRYABLE_ERRORS.some((code) => msg.includes(code));
  }

  /**
   * 发起 HTTP 请求（内部方法）
   *
   * 自动处理：
   * - 参数序列化（数组用 | 拼接）
   * - User-Agent 设置
   * - 请求超时（默认从应用设置读取，可通过 options.timeout 覆盖）
   * - 任务取消信号中断（手动停止时立即打断在飞请求，且不再重试）
   * - 重试逻辑（根据设置中的 retryCount 和 retryInterval）
   * - 错误解析
   * - 失败时抛出 {@link MoegirlRequestError}
   */
  private async request<T = Record<string, any>>(
    method: 'GET' | 'POST',
    params: ApiParams,
    options?: RequestOptions,
  ): Promise<T> {
    const { retryCount, retryInterval, requestTimeout, userAgent } = getAllSettings();
    /** 最大重试次数 */
    const retries = options?.retries ?? retryCount;
    /** 请求超时时间（毫秒） */
    const timeout = options?.timeout ?? requestTimeout;
    const taskSignal = abortSignalStorage.getStore();

    /** 合并默认参数与传入参数后的扁平化键值对（数组以 | 拼接，false 值剔除） */
    const merged: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...DEFAULT_PARAMS, ...params })) {
      if (value !== false) {
        merged[key] = Array.isArray(value) ? value.join('|') : String(value);
      }
    }

    const url = method === 'GET'
      ? `${this.url}?${new URLSearchParams(merged).toString()}`
      : this.url;
    const init: RequestInit = {
      method,
      headers: { 'User-Agent': userAgent },
      body: method === 'POST' ? new URLSearchParams(merged) : undefined,
      // 主进程 fetch 没有 origin 概念，默认 same-origin 不会携带 cookie，
      // 需显式 include 才能复用 session cookie jar 中的登录态
      credentials: 'include',
    };

    let lastError: Error | null = null;
    /** 最近一次失败请求的响应状态，每次尝试前重置 */
    let lastStatus: number | undefined;
    /** 最近一次失败请求的响应体，每次尝试前重置 */
    let lastResponseBody: string | undefined;
    /** 已请求次数 */
    let attempt = 0;

    // 未达到重试次数上限前失败重试
    for (; attempt < retries + 1; attempt++) {
      // 任务已被手动停止时无需再发请求
      if (taskSignal?.aborted) {
        break;
      }
      // 全局节流：按设置的最小请求间隔放行，避免高频请求触发站点限流。
      // 放在 controller/timeout 创建之前，避免等待期间触发请求超时；等待中被取消时直接结束本次尝试。
      await acquireThrottleSlot(taskSignal);
      if (taskSignal?.aborted) {
        break;
      }
      // 每次尝试前重置响应记录，避免上一次尝试的响应残留到本次网络错误
      lastStatus = undefined;
      lastResponseBody = undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      // 任务取消信号触发时立即中断本次在飞请求
      const onTaskAbort = () => controller.abort();
      taskSignal?.addEventListener('abort', onTaskAbort, { once: true });
      try {
        const res = await this.session.fetch(url, { ...init, signal: controller.signal });
        if (!res.ok) {
          // 读取错误响应体（可能是 HTML 错误页，如 504），供失败日志诊断
          lastStatus = res.status;
          lastResponseBody = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}`);
        }
        // 先读取文本再解析：响应非 JSON（如代理返回 HTML 错误页）时也能记录响应体供诊断
        const body = await res.text();
        let data: Record<string, any>;
        try {
          data = JSON.parse(body);
        } catch (e) {
          lastStatus = res.status;
          // 截断响应体避免过长日志，仅保留前 500 字符用于诊断
          lastResponseBody = body.slice(0, 500);
          throw new Error(`响应解析失败：${(e as Error).message}`, { cause: e });
        }
        if (data?.error) {
          lastStatus = res.status;
          lastResponseBody = body;
          throw new Error(data.error.info || data.error.code);
        }
        return data as T;
      } catch (error) {
        lastError = error as Error;
        // 任务被手动停止时不再重试，直接结束
        if (taskSignal?.aborted) {
          break;
        }
        // 不可重试的错误直接抛出
        if (attempt < retries && this.isRetryable(lastError)) {
          await new Promise<void>((resolve) => {
            const waitTimer = setTimeout(resolve, retryInterval);
            taskSignal?.addEventListener(
              'abort',
              () => {
                clearTimeout(waitTimer);
                resolve();
              },
              { once: true },
            );
          });
        } else {
          break;
        }
      } finally {
        clearTimeout(timer);
        taskSignal?.removeEventListener('abort', onTaskAbort);
      }
    }

    // 任务被手动停止：抛出 AbortError，由上层（runner）识别为手动停止
    if (taskSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const error = lastError ?? new Error('请求失败');
    throw new MoegirlRequestError(
      error,
      params.action,
      attempt,
      { method, requestParams: merged, status: lastStatus, responseBody: lastResponseBody, timeout },
    );
  }
}

// #endregion
