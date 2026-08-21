import { protocol } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

/** 扩展名 → MIME 类型映射（用于 local-file 协议） */
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** 对话框筛选器使用的扩展名列表 */
export const IMAGE_EXTENSIONS_FILTER = Object.keys(EXT_TO_MIME).map((ext) => ext.slice(1));

/** 注册 local-file 自定义协议为特权协议，替代直接 file:// 访问本地文件（在 app ready 前调用） */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * 注册 local-file 协议处理器（在 app ready 后调用）。
 * `local-file://localhost/?path=<encoded>` 读取本地图片，
 * 路径放 query 参数规避 Chromium 对盘符/前导斜杠的 URL 规范化，跨平台一致。
 */
export function registerLocalFileProtocol(): void {
  protocol.handle('local-file', async (request) => {
    const filePath = new URL(request.url).searchParams.get('path') ?? '';
    const contentType = EXT_TO_MIME[path.extname(filePath).toLowerCase()];
    if (!contentType) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = await fs.readFile(filePath);
      return new Response(data, { headers: { 'Content-Type': contentType } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
