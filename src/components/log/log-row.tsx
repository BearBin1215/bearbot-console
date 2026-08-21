import { memo, useMemo, useState, type ReactNode } from 'react';
import { CopyOutlined } from '@ant-design/icons';
import { App, Button, Tooltip } from 'antd';
import dayjs from 'dayjs';
import type { LogLevel } from '@shared/types';
import type { LogEntry } from '@/stores/log-store';
import MoegirlLink from '../moegirl-link';

/** 各日志等级对应的文本颜色 */
const LEVEL_COLOR: Record<LogLevel, string> = {
  INFO: 'text-blue-600',
  WARN: 'text-orange-600',
  ERROR: 'text-red-600',
};

/** 富文本节点：纯文本、萌娘百科链接，或可嵌套的加粗/斜体区间 */
type MessageNode =
  | { type: 'text'; content: string }
  | { type: 'link'; page: string; text: string }
  | { type: 'bold'; children: MessageNode[] }
  | { type: 'italic'; children: MessageNode[] };

/** 词法标记：文本、链接，或一段连续的半角单引号 */
type Token =
  | { type: 'text'; content: string }
  | { type: 'link'; page: string; text: string }
  | { type: 'quote'; count: number };

/**
 * 将消息切分为标记流
 *
 * 连续两个及以上的半角单引号作为一个整体标记（记录数量），内部链接 [[页面名]] 单独切分。
 * 不在链接内部进一步解析单引号，因此链接显示文本不会被当作格式标记。
 *
 * 示例：'已将文本更新到[[沙盒]]页面'
 * 切分为：[text, link(page='沙盒'), text]
 */
function tokenize(message: string): Token[] {
  const tokens: Token[] = [];
  const regex = /'{2,}|\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: message.slice(lastIndex, match.index) });
    }
    if (match[0].startsWith('[[')) {
      // MediaWiki 语法：首个 | 之前为页面名，之后为显示文本；无 | 时显示文本等于页面名
      const inner = match[1];
      const sepIdx = inner.indexOf('|');
      const page = sepIdx === -1 ? inner : inner.slice(0, sepIdx);
      const text = sepIdx === -1 ? inner : inner.slice(sepIdx + 1);
      tokens.push({ type: 'link', page, text });
    } else {
      tokens.push({ type: 'quote', count: match[0].length });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < message.length) {
    tokens.push({ type: 'text', content: message.slice(lastIndex) });
  }
  return tokens;
}

/**
 * 将一段连续单引号折算为待切换的格式与多余文本
 *
 * - 2 个：斜体
 * - 3 个：加粗
 * - 4 个：加粗 + 1 个多余单引号（作为纯文本）
 * - 5 个及以上：同时切换加粗与斜体，多余引号作为纯文本
 *
 * 其中 5 个单引号对应 MediaWiki 的粗斜体，由解析器按当前开闭状态决定先关哪个。
 */
function planQuotes(count: number): { toggles: Array<'bold' | 'italic'>; leftover: string } {
  if (count === 2) { return { toggles: ['italic'], leftover: '' }; }
  if (count === 3) { return { toggles: ['bold'], leftover: '' }; }
  if (count === 4) { return { toggles: ['bold'], leftover: "'" }; }
  return {
    toggles: ['bold', 'italic'],
    leftover: "'".repeat(count - 5),
  };
}

/** 格式容器：根节点或正在构建的加粗/斜体区间 */
type Container = { type: 'root' | 'bold' | 'italic'; children: MessageNode[] };

/**
 * 将消息解析为富文本节点树
 *
 * 格式切换遵循：
 * - 先关闭栈中已开启的格式（按栈顶到栈底顺序，保证内层先于外层闭合，维持正确嵌套）
 * - 再开启未开启的格式（加粗先于斜体，使斜体嵌套在加粗内部）
 * 如此例如五单引号收尾等场景先闭合斜体再闭合加粗。
 * 关闭外层格式时，其内嵌套的未闭合格式会被重新开启以延续作用域
 * （如'''''粗斜体'''斜体'' 在闭合加粗后斜体继续生效）。
 * 链接内的显示文本不再解析格式标记。
 */
function parseMessage(message: string): MessageNode[] {
  const tokens = tokenize(message);
  const root: Container = { type: 'root', children: [] };
  const stack: Container[] = [root];

  /** 栈中是否存在指定格式的未闭合区间 */
  const has = (fmt: 'bold' | 'italic') => stack.some((c) => c.type === fmt);
  /** 栈中最近一个指定格式的索引，不存在返回 -1 */
  const depthOf = (fmt: 'bold' | 'italic') => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === fmt) {
        return i;
      }
    }
    return -1;
  };
  /** 开启一个新的指定格式区间 */
  const open = (fmt: 'bold' | 'italic') => {
    const node = fmt === 'bold'
      ? { type: 'bold' as const, children: [] as MessageNode[] }
      : { type: 'italic' as const, children: [] as MessageNode[] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  };
  /**
   * 关闭最近一个指定格式
   *
   * 若该格式之内还嵌套着其他未闭合格式，则先一并闭合、再在关闭后重新开启，
   * 使内层格式的作用域延续到外层之外（对齐 MediaWiki 的处理，如
   * '''''粗斜体'''斜体'' 会在闭合加粗后让斜体继续生效）。
   */
  const close = (fmt: 'bold' | 'italic') => {
    const idx = depthOf(fmt);
    if (idx === -1) { return; }
    // fmt 之上的嵌套格式（外->内顺序），关闭后按序重新开启以延续其作用域
    const reopened = stack.slice(idx + 1)
      .map((c) => c.type)
      .filter((t): t is 'bold' | 'italic' => t === 'bold' || t === 'italic');
    stack.length = idx;
    for (const f of reopened) { open(f); }
  };
  /** 应用一组格式切换：先关闭已开启的（栈顶优先），再开启未开启的（加粗优先） */
  const applyToggles = (toggles: Array<'bold' | 'italic'>) => {
    const order: Array<'bold' | 'italic'> = ['bold', 'italic'];
    // toClose 与 toOpen 须在执行关闭前一并计算，避免关闭后状态变化导致误重新开启
    const toClose = order
      .filter((t) => toggles.includes(t) && has(t))
      .sort((a, b) => depthOf(b) - depthOf(a));
    const toOpen = order.filter((t) => toggles.includes(t) && !has(t));
    for (const f of toClose) { close(f); }
    for (const f of toOpen) { open(f); }
  };

  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.type === 'text') {
      top.children.push({ type: 'text', content: token.content });
    } else if (token.type === 'link') {
      top.children.push({ type: 'link', page: token.page, text: token.text });
    } else {
      const { toggles, leftover } = planQuotes(token.count);
      applyToggles(toggles);
      if (leftover) {
        stack[stack.length - 1].children.push({ type: 'text', content: leftover });
      }
    }
  }
  return root.children;
}

/** 递归渲染富文本节点 */
function renderNodes(nodes: MessageNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <span key={i}>{node.content}</span>;
      case 'link':
        return <MoegirlLink key={i} title={node.page}>{node.text}</MoegirlLink>;
      case 'bold':
        return <b key={i}>{renderNodes(node.children)}</b>;
      case 'italic':
        return <i key={i}>{renderNodes(node.children)}</i>;
    }
  });
}

/** 半宽空格分隔符：文本内容仍为普通空格（复制时保留），视觉宽度为常规空格的一半 */
function HalfSpace() {
  return <span className='text-[0.5em]'>{' '}</span>;
}

interface LogRowProps {
  /** 日志条目 */
  log: LogEntry;
  /** 任务名（由父组件根据 taskKey 动态查找后传入） */
  taskName: string;
}

/**
 * 单条日志行
 *
 * 支持 wikitext 的`[[内链]]、'''加粗'''、''斜体''`语法。点击链接在系统浏览器打开萌百页面。
 */
const LogRow = memo(({ log, taskName }: LogRowProps) => {
  const parts = useMemo(() => parseMessage(log.message), [log.message]);
  const displayTime = dayjs(log.time).format('MM-DD HH:mm:ss');
  const [detailExpanded, setDetailExpanded] = useState(false);
  const { message } = App.useApp();

  return (
    <div className='border-b border-dashed border-ant-secondary py-0.75 text-xs'>
      <span className='whitespace-nowrap text-gray-400 monospace'>
        {displayTime}
      </span>
      <HalfSpace />
      <b className={LEVEL_COLOR[log.level]}>
        {log.level}
      </b>
      <HalfSpace />
      <span className='break-all text-gray-700'>
        <span className='text-gray-500'>[{log.system ? 'SYS' : taskName}]</span>
        {renderNodes(parts)}
      </span>
      {log.detail && (
        <a
          className='pl-3'
          onClick={() => setDetailExpanded(!detailExpanded)}
        >
          {detailExpanded ? '收起详情' : '查看详情'}
        </a>
      )}
      {detailExpanded && (
        <div className='relative mt-0.5'>
          <Tooltip title='复制'>
            <Button
              type='text'
              size='small'
              icon={<CopyOutlined />}
              className='absolute! right-1.5 top-0.5 z-10'
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(log.detail ?? '');
                  message.success('已复制');
                } catch {
                  message.error('复制失败');
                }
              }}
            />
          </Tooltip>
          <pre
            className={`
              max-h-60 overflow-auto pr-6
              whitespace-pre-wrap break-all text-xs text-gray-600
              rounded bg-gray-50 p-1
            `}
          >
            {log.detail}
          </pre>
        </div>
      )}
    </div>
  );
});

export default LogRow;
