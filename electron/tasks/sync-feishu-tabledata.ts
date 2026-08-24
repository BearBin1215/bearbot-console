import type { TaskHandler } from '../services/tasks/types';

/** 飞书表格配置（硬编码） */
const FEISHU_TABLE = {
  /** 飞书表格 API 基础地址 */
  baseURL: 'https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/',
  /** galgame 条目统计表 spreadsheetToken */
  spreadsheetToken: 'shtcnTQQ5n5HkdGwiiYEtE1FHZ9',
  /** 日本作品工作表 ID */
  sheetId: '0rCQAp',
  /** 读取范围：从第 2 行起，获取 A、B 列内容（原名、译名） */
  range: '!A2:B',
} as const;

/** 保存目标页面 */
const TARGET_PAGE = 'User:柏喙意志/Gal条目表';

/** 飞书 API 响应公共字段 */
interface FeishuResponse {
  code: number;
  msg?: string;
}

/** 飞书 tenant_access_token 响应 */
interface FeishuTokenResponse extends FeishuResponse {
  tenant_access_token: string;
}

/** 飞书表格数据响应 */
interface FeishuSheetResponse extends FeishuResponse {
  data: {
    valueRange: {
      values: string[][];
    };
  };
}

/**
 * 发起飞书 API 请求，统一处理 HTTP 错误与业务错误码
 * @param url 请求地址
 * @param options fetch 参数（含 signal）
 * @param errorContext 错误描述前缀
 * @returns 解析后的响应数据
 */
async function feishuRequest<T extends FeishuResponse>(
  url: string,
  options: RequestInit,
  errorContext: string,
): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${errorContext}：HTTP ${response.status}`);
  }
  const data = await response.json() as T;
  if (data.code !== 0) {
    throw new Error(`${errorContext}：${data.msg ?? data.code}`);
  }
  return data;
}

/**
 * 用表格内容生成 wikitext
 * @param values 飞书表格内容（A 列原名、B 列译名）
 * @returns wikitext
 */
function generateText(values: string[][]): string {
  const pageList: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row?.[0]) {
      break;
    }
    if (i % 100 === 0) {
      pageList.push(`\n== ${i + 1}～${i + 100} ==`);
    }
    const ja = row[0].replaceAll('\n', '').trim();
    const pagename = row[1]?.replaceAll('\n', '').trim() || ja;
    pageList.push(`#{{lj|[[${ja}]]}}->[[${pagename}]]`);
  }
  return `{{info|本页面由机器人自动同步自飞书表格，因此不建议直接更改此表。}}\n${pageList.join('\n')}`;
}

/**
 * 同步飞书表格数据到[[User:柏喙意志/Gal条目表]]
 *
 * 从飞书 galgame 条目统计表读取日本作品的原名与译名，生成 wikitext 列表后保存到用户子页面。
 * 飞书 App ID 与 App Secret 通过任务参数传入（必填）。
 */
const syncFeishuTableData: TaskHandler = async ({ api, logger, signal, params }) => {
  /** 获取飞书 tenant_access_token */
  const getTenantAccessToken = async (): Promise<string> => {
    const data = await feishuRequest<FeishuTokenResponse>(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: String(params.appId),
          app_secret: String(params.appSecret),
        }),
        signal,
      },
      '获取 TenantAccessToken 失败',
    );
    return data.tenant_access_token;
  };

  /** 获取飞书表格内容 */
  const getTableContent = async (accessToken: string): Promise<string[][]> => {
    const url = `${FEISHU_TABLE.baseURL}${FEISHU_TABLE.spreadsheetToken}/values/${FEISHU_TABLE.sheetId}${FEISHU_TABLE.range}`;
    const data = await feishuRequest<FeishuSheetResponse>(
      url,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal,
      },
      '读取飞书统计表失败',
    );
    return data.data.valueRange.values;
  };

  const accessToken = await getTenantAccessToken();
  logger.info('获取飞书访问token成功');

  const values = await getTableContent(accessToken);
  logger.info(`读取飞书统计表成功，共 ${values.length} 行`);

  const text = generateText(values);

  await api.editPage(TARGET_PAGE, text, '自动同步自飞书');
};

export default syncFeishuTableData;
