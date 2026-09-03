/** Markdown v5 内容规则：规范化、工具栏能力白名单与字面文本降级。 */

import { HttpStatus } from '@nestjs/common';
import MarkdownIt from 'markdown-it';
import { BusinessException } from './exceptions/business.exception';
import { ErrorCode } from './exceptions/error-codes';

const EMPTY_IMAGE_RE = /!\[[^\]]*\]\(\s*\)/g;
const EMPTY_LINK_RE = /\[[^\]]*\]\(\s*\)/g;
const IMAGE_RE = /!\[[^\]]*\]\(\s*[^)\s]+[^)]*\)/;
const LINK_RE = /\[([^\]]+)\]\(\s*[^)\s]+[^)]*\)/g;
const HTTP_AUTOLINK_RE = /<https?:\/\/[^\s<>]+>/iu;
const HTML_RE = /<[^>]*>/g;
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const EMPTY_PARAGRAPH_RE = /^ {0,3}<br\s*\/?>[\t ]*$/iu;
const TASK_LIST_RE = /^(?: {0,3}>[\t ]*)*[\t ]*(?:[-+*]|\d+[.)])[\t ]+\[[ xX]\](?:[\t ]|$)/u;
const UNKNOWN_PROTOCOL_RE = /\[\[([a-z][a-z0-9_-]*):v(\d+):/giu;
const ALIGNMENT_MARKER_RE = /^\[wenyousite-align-v1-(center|right)\]: #$/u;
const ALIGNMENT_PROTOCOL_RE = /\[wenyousite-align-v(\d+)-([a-z][a-z-]*)\]:/giu;
const STICKER_TITLE_PREFIX = 'wenyousite-sticker:v1:';
const WORD_JOINER = '\u2060';
const MAX_LIST_DEPTH = 3;

/** 当前公网声明的 Markdown 正文契约版本。 */
export const ACTIVE_MARKDOWN_CONTRACT_VERSION = 5;
export const IMAGE_ALIGNMENT_MARKDOWN_CONTRACT_VERSION = 5;

export interface MarkdownValidationOptions {
  markdownContractVersion?: number;
}

/** 仅用于可见性判断；保留原文，避免破坏 ZWJ Emoji 和变体选择符。 */
const DEFAULT_IGNORABLE_RE =
  // eslint-disable-next-line no-misleading-character-class -- 此处按 Unicode code point 明确列举默认不可见字符及组合选择符。
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/gu;

export const UNSUPPORTED_MARKDOWN_TYPE_LABELS = {
  table: '表格',
  'task-list': '任务列表',
  'fenced-code-block': '围栏代码块',
  'indented-code-block': '缩进代码块',
  'heading-1': '一级标题',
  'heading-4-6': '四至六级标题',
  'hard-break': '显式硬换行',
  'raw-html': '原始 HTML',
  'unknown-protocol': '未知协议节点',
  'invalid-alignment': '无效的段落对齐',
  'list-depth': '超过三层的嵌套列表',
  'unsafe-link': '不安全链接',
  'unknown-node': '未知 Markdown 节点',
} as const;

export type UnsupportedMarkdownType = keyof typeof UNSUPPORTED_MARKDOWN_TYPE_LABELS;

export interface UnsupportedMarkdownIssue {
  type: UnsupportedMarkdownType;
  startLine: number;
  endLine: number;
}

const markdownParser = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
});

/** 将跨端 Markdown 转为 v4 标准存储形式；不 trim、不做 Unicode 归一化。 */
export function normalizeMarkdownContent(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let fence: { marker: '`' | '~'; length: number } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceToken = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];

    if (fence) {
      const closingToken = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/)?.[1];
      if (closingToken?.[0] === fence.marker && closingToken.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceToken) {
      fence = { marker: fenceToken[0] as '`' | '~', length: fenceToken.length };
      continue;
    }
    if (EMPTY_PARAGRAPH_RE.test(line)) {
      lines[index] = '<br />';
      continue;
    }
    lines[index] = line.replace(EMPTY_IMAGE_RE, '');
  }

  return lines.join('\n');
}

function issue(
  type: UnsupportedMarkdownType,
  map: [number, number] | null | undefined,
): UnsupportedMarkdownIssue {
  return {
    type,
    startLine: map?.[0] ?? 0,
    endLine: Math.max((map?.[1] ?? 1) - 1, map?.[0] ?? 0),
  };
}

function isSafeUrl(url: string, image: boolean): boolean {
  if (/^(?:https?:\/\/|\/)/iu.test(url)) return true;
  if (!image && /^(?:mailto:|#)/iu.test(url)) return true;
  return false;
}

function hardBreakLines(lines: string[], start: number, end: number): number[] {
  const result: number[] = [];
  for (let line = start; line < end; line++) {
    const value = lines[line] ?? '';
    const trailingSpaces = value.match(/ +$/u)?.[0].length ?? 0;
    const trailingBackslashes = value.match(/\\+$/u)?.[0].length ?? 0;
    if (trailingSpaces >= 2 || trailingBackslashes % 2 === 1) result.push(line);
  }
  return result;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function maskInlineCode(line: string): string {
  const chars = [...line];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== '`' || isEscaped(line, index)) {
      index++;
      continue;
    }
    let length = 1;
    while (line[index + length] === '`') length++;
    const delimiter = '`'.repeat(length);
    const closing = line.indexOf(delimiter, index + length);
    if (closing < 0) {
      index += length;
      continue;
    }
    for (let cursor = index; cursor < closing + length; cursor++) chars[cursor] = ' ';
    index = closing + length;
  }
  return chars.join('');
}

/** 返回按源码位置排序的全部不支持结构；空段落协议行会在解析前被安全占位。 */
export function findUnsupportedMarkdownFormats(
  markdown: string,
  options: MarkdownValidationOptions = {},
): UnsupportedMarkdownIssue[] {
  const markdownContractVersion =
    options.markdownContractVersion ?? ACTIVE_MARKDOWN_CONTRACT_VERSION;
  const imageAlignmentEnabled =
    markdownContractVersion >= IMAGE_ALIGNMENT_MARKDOWN_CONTRACT_VERSION;
  const normalized = normalizeMarkdownContent(markdown);
  const lines = normalized.split('\n');
  const parseSource = lines
    .map((line) => (EMPTY_PARAGRAPH_RE.test(line) ? 'wenyousite-empty-paragraph' : line))
    .join('\n');
  const issues: UnsupportedMarkdownIssue[] = [];
  let listDepth = 0;
  const tokens = markdownParser.parse(parseSource, {});

  for (const token of tokens) {
    switch (token.type) {
      case 'table_open':
        issues.push(issue('table', token.map));
        break;
      case 'fence':
        issues.push(issue('fenced-code-block', token.map));
        break;
      case 'code_block':
        issues.push(issue('indented-code-block', token.map));
        break;
      case 'heading_open': {
        const level = Number(token.tag.slice(1));
        if (level === 1) issues.push(issue('heading-1', token.map));
        if (level >= 4) issues.push(issue('heading-4-6', token.map));
        break;
      }
      case 'html_block':
        issues.push(issue('raw-html', token.map));
        break;
      case 'bullet_list_open':
      case 'ordered_list_open':
        listDepth++;
        if (listDepth > MAX_LIST_DEPTH) issues.push(issue('list-depth', token.map));
        break;
      case 'bullet_list_close':
      case 'ordered_list_close':
        listDepth--;
        break;
      case 'inline': {
        const map = token.map;
        if (token.children?.some((child) => child.type === 'hardbreak')) {
          for (const line of hardBreakLines(lines, map?.[0] ?? 0, map?.[1] ?? 1)) {
            issues.push({ type: 'hard-break', startLine: line, endLine: line });
          }
        }
        for (const child of token.children ?? []) {
          if (child.type === 'html_inline') {
            issues.push(issue('raw-html', map));
          } else if (child.type === 'link_open') {
            const href = child.attrGet('href') ?? '';
            if (!isSafeUrl(href, false)) issues.push(issue('unsafe-link', map));
          } else if (child.type === 'image') {
            const src = child.attrGet('src') ?? '';
            if (!isSafeUrl(src, true)) issues.push(issue('unsafe-link', map));
          }
        }
        break;
      }
      case 'paragraph_open':
      case 'paragraph_close':
      case 'text':
      case 'softbreak':
      case 'code_inline':
      case 'em_open':
      case 'em_close':
      case 'strong_open':
      case 'strong_close':
      case 's_open':
      case 's_close':
      case 'link_open':
      case 'link_close':
      case 'image':
      case 'heading_close':
      case 'blockquote_open':
      case 'blockquote_close':
      case 'list_item_open':
      case 'list_item_close':
      case 'hr':
      case 'table_close':
      case 'thead_open':
      case 'thead_close':
      case 'tbody_open':
      case 'tbody_close':
      case 'tr_open':
      case 'tr_close':
      case 'th_open':
      case 'th_close':
      case 'td_open':
      case 'td_close':
        break;
      default:
        issues.push(issue('unknown-node', token.map));
    }
  }

  const topLevelBlocks = new Map(
    tokens
      .filter(
        (token) =>
          token.level === 0 &&
          token.map &&
          (token.type === 'paragraph_open' || token.type === 'heading_open'),
      )
      .map((token) => [token.map![0], token]),
  );

  for (let line = 0; line < lines.length; line++) {
    if (TASK_LIST_RE.test(lines[line])) {
      issues.push({ type: 'task-list', startLine: line, endLine: line });
    }
    const masked = maskInlineCode(lines[line]);
    const alignmentMarker = lines[line].match(ALIGNMENT_MARKER_RE);
    if (alignmentMarker) {
      const target = topLevelBlocks.get(line + 1);
      const inline = target
        ? tokens.find(
            (token) =>
              token.type === 'inline' &&
              token.map?.[0] === target.map?.[0] &&
              token.map?.[1] === target.map?.[1],
          )
        : undefined;
      const inlineChildren = inline?.children ?? [];
      const hasRegularImage = inlineChildren.some(
        (child) =>
          child.type === 'image' && !child.attrGet('title')?.startsWith(STICKER_TITLE_PREFIX),
      );
      const hasStandaloneRegularImage =
        imageAlignmentEnabled &&
        inlineChildren.length === 1 &&
        inlineChildren[0]?.type === 'image' &&
        !inlineChildren[0].attrGet('title')?.startsWith(STICKER_TITLE_PREFIX);
      const hasInlineContent = Boolean(inline?.content.trim());
      const eligibleHeading =
        target?.type === 'heading_open' &&
        (target.tag === 'h2' || target.tag === 'h3') &&
        hasInlineContent &&
        !hasRegularImage;
      const eligibleParagraph =
        target?.type === 'paragraph_open' &&
        !EMPTY_PARAGRAPH_RE.test(lines[line + 1] ?? '') &&
        ((hasInlineContent && !hasRegularImage) || hasStandaloneRegularImage);
      if (!eligibleHeading && !eligibleParagraph) {
        issues.push({ type: 'invalid-alignment', startLine: line, endLine: line });
      }
      continue;
    }
    for (const match of masked.matchAll(ALIGNMENT_PROTOCOL_RE)) {
      if (isEscaped(lines[line], match.index ?? 0)) continue;
      issues.push({
        type: match[1] === '1' ? 'invalid-alignment' : 'unknown-protocol',
        startLine: line,
        endLine: line,
      });
      break;
    }
    for (const match of masked.matchAll(UNKNOWN_PROTOCOL_RE)) {
      if (isEscaped(lines[line], match.index ?? 0)) continue;
      if (match[1].toLowerCase() === 'dice' && match[2] === '1') continue;
      issues.push({ type: 'unknown-protocol', startLine: line, endLine: line });
      break;
    }
  }

  const seen = new Set<string>();
  return issues
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine)
    .filter((item) => {
      const key = `${item.type}:${item.startLine}:${item.endLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function assertSupportedMarkdown(
  markdown: string,
  options: MarkdownValidationOptions = {},
): void {
  const first = findUnsupportedMarkdownFormats(markdown, options)[0];
  if (!first) return;
  throw new BusinessException(
    ErrorCode.UNSUPPORTED_MARKDOWN_FORMAT,
    `正文包含不支持的 Markdown 格式：${UNSUPPORTED_MARKDOWN_TYPE_LABELS[first.type]}`,
    HttpStatus.BAD_REQUEST,
  );
}

/** 所有正文写入口必须先调用本函数，再进入骰子、图片、提及或持久化处理。 */
export function prepareMarkdownContent(
  markdown: string,
  options: MarkdownValidationOptions = {},
): string {
  const normalized = normalizeMarkdownContent(markdown);
  assertSupportedMarkdown(normalized, options);
  return normalized;
}

function escapeLiteralLine(line: string): string {
  let escaped = line.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu, '\\$&');
  if (/^(?: {4}|\t)/u.test(line)) escaped = `${WORD_JOINER}${escaped}`;
  if (/ {2,}$/u.test(line)) escaped = `${escaped}${WORD_JOINER}`;
  return escaped || WORD_JOINER;
}

/** 将不支持节点的原始源码保留为可见普通文字；用于客户端防御降级与数据迁移。 */
export function literalizeUnsupportedMarkdown(
  markdown: string,
  options: MarkdownValidationOptions = {},
): string {
  const normalized = normalizeMarkdownContent(markdown);
  const issues = findUnsupportedMarkdownFormats(normalized, options);
  if (issues.length === 0) return normalized;
  const lines = normalized.split('\n');
  const affected = new Set<number>();
  for (const item of issues) {
    for (let line = item.startLine; line <= item.endLine; line++) affected.add(line);
  }
  const output: string[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (!affected.has(line)) {
      output.push(lines[line]);
      continue;
    }
    if (output.length > 0 && output.at(-1) !== '') output.push('');
    output.push(escapeLiteralLine(lines[line]));
    if (line < lines.length - 1) output.push('');
  }
  return output.join('\n');
}

function hasNonIgnorableText(value: string): boolean {
  return value.replace(DEFAULT_IGNORABLE_RE, '').trim().length > 0;
}

/** 判断 Markdown 是否含有文字、图片或其他可发布内容。 */
export function hasVisibleMarkdownContent(markdown: string): boolean {
  const lines = normalizeMarkdownContent(markdown).split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      THEMATIC_BREAK_RE.test(rawLine) ||
      EMPTY_PARAGRAPH_RE.test(rawLine) ||
      ALIGNMENT_MARKER_RE.test(rawLine)
    ) {
      continue;
    }
    if (IMAGE_RE.test(line)) return true;
    if (HTTP_AUTOLINK_RE.test(line)) return true;
    const visible = line
      .replace(EMPTY_IMAGE_RE, '')
      .replace(EMPTY_LINK_RE, '')
      .replace(LINK_RE, '$1')
      .replace(HTML_RE, '')
      .replace(/^[#>+\-\s]+/u, '')
      .replace(/^\d+[.)]\s*/u, '')
      .replace(/[*_~`]/g, '')
      .replace(DEFAULT_IGNORABLE_RE, '')
      .trim();
    if (hasNonIgnorableText(visible)) return true;
  }
  return false;
}
