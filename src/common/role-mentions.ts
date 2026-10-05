import MarkdownIt from 'markdown-it';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './exceptions/business.exception';
import { ErrorCode } from './exceptions/error-codes';

export const ROLE_MENTION_VERSION = 6;
export const MARKDOWN_CAPABILITY_HEADER = 'X-Markdown-Contract-Version';
export type MentionTarget = {
  userId: string; label: string; sourceHref: string;
  targetIdentityId: string | null; mode: 'LEGACY' | 'ACCOUNT' | 'RP';
  start: number; end: number;
};
const codeParser = new MarkdownIt({ html: true });
/** 按 Markdown 块边界遮蔽代码并保留 UTF-16 偏移；规范提及标签是原子文字。 */
export function maskMentionCode(content: string): string {
  const chars = content.split('');
  const lines = content.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) { offsets.push(cursor); cursor += line.length + 1; }
  const mask = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  };
  for (const block of codeParser.parse(content, {})) {
    if (!block.map) continue;
    if (block.type === 'fence' || block.type === 'code_block') {
      mask(offsets[block.map[0]], offsets[block.map[1]] ?? content.length); continue;
    }
    if (block.type !== 'inline') continue;
    const inlineLines = block.content.split('\n');
    const inlineOffsets: number[] = [], absoluteLines: Array<number | undefined> = [];
    let inlineCursor = 0;
    for (let relative = 0; relative < inlineLines.length; relative++) {
      inlineOffsets.push(inlineCursor); inlineCursor += inlineLines[relative].length + 1;
      const line = block.map[0] + relative;
      const column = lines[line].lastIndexOf(inlineLines[relative]);
      absoluteLines.push(column < 0 ? undefined : offsets[line] + column);
    }
    const absoluteOffset = (offset: number) => {
      let low = 0, high = inlineOffsets.length;
      while (low + 1 < high) { const middle = (low + high) >>> 1; if (inlineOffsets[middle] <= offset) low = middle; else high = middle; }
      return absoluteLines[low] === undefined ? undefined : absoluteLines[low]! + offset - inlineOffsets[low];
    };
    const inline = block.content;
    let position = 0;
    while (position < inline.length) {
      const mention = inline[position] === '[' ? /^\[@[^\]\r\n]*\]\([ \t]*\/users\/[^)\r\n]*\)/.exec(inline.slice(position))?.[0] : null;
      if (mention) { position += mention.length; continue; }
      if (inline[position] !== '`' || isMentionEscaped(inline, position)) { position++; continue; }
      const start = position;
      while (inline[position] === '`') position++;
      const length = position - start;
      let next = position, end = -1;
      while (next < inline.length) {
        const runStart = inline.indexOf('`', next);
        if (runStart < 0) break;
        next = runStart;
        while (inline[next] === '`') next++;
        if (next - runStart === length) { end = next; break; }
      }
      if (end < 0) continue;
      const absoluteStart = absoluteOffset(start), absoluteEnd = absoluteOffset(end);
      if (absoluteStart !== undefined && absoluteEnd !== undefined) mask(absoluteStart, absoluteEnd);
      position = end;
    }
  }
  return chars.join('');
}
export function isMentionEscaped(content: string, offset: number): boolean {
  let slashes = 0;
  for (let i = offset - 1; i >= 0 && content[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}
export function mentionSourceKey(token: Pick<MentionTarget, 'sourceHref' | 'label'>): string {
  return JSON.stringify([token.sourceHref, token.label]);
}
export function parseMentionSources(content: string, strict = false): MentionTarget[] {
  if (!content.includes('/users/')) return [];
  const masked = maskMentionCode(content);
  const result: MentionTarget[] = [];
  for (const match of masked.matchAll(/\[@([^\]\r\n]*)\]\(([ \t]*\/users\/[^)\r\n]*)\)/g)) {
    if (isMentionEscaped(content, match.index!) || (content[match.index! - 1] === '!' && !isMentionEscaped(content, match.index! - 1))) continue;
    const [, label, sourceHref] = match;
    const href = /^\/users\/([a-zA-Z0-9_-]+)(?:\?(rpIdentityId=([a-zA-Z0-9_-]+)|identityMode=ACCOUNT))?$/.exec(sourceHref);
    const valid = href && label.length > 0 && Array.from(label).length <= 32 && (!href[3] || /^c[a-z0-9]{24}$/.test(href[3]));
    if (!valid) {
      if (strict) throw new BusinessException(ErrorCode.RP_MENTION_CHANGED, '提及目标不合法，请保留正文并重新选择', HttpStatus.CONFLICT);
      continue;
    }
    result.push({ userId: href[1], label, sourceHref, targetIdentityId: href[3] ?? null,
      mode: href[3] ? 'RP' : href[2] ? 'ACCOUNT' : 'LEGACY', start: match.index!, end: match.index! + match[0].length });
  }
  return result;
}
export function hasRoleMentionSource(content: string): boolean {
  return parseMentionSources(content).some((row) => row.mode !== 'LEGACY');
}
/** 客户端能力与激活开关分离；关闭新写仍允许有能力客户端保存/删除既有节点。 */
export function assertRoleMentionWrite(content: string, previous = '', version?: number, enabled = false): void {
  const next = parseMentionSources(content, true);
  const old = parseMentionSources(previous);
  if (![...next, ...old].some((row) => row.mode !== 'LEGACY')) return;
  if (version !== ROLE_MENTION_VERSION) throw new BusinessException(ErrorCode.MARKDOWN_CAPABILITY_REQUIRED,
    '正文包含角色提及，请保留草稿并升级支持 Markdown 6 的编辑器', HttpStatus.CONFLICT);
  const saved = new Set(old.filter((row) => row.mode !== 'LEGACY').map(mentionSourceKey));
  if (!enabled && next.some((row) => row.mode !== 'LEGACY' && !saved.has(mentionSourceKey(row))))
    throw new BusinessException(ErrorCode.ROLE_MENTIONS_DISABLED, '角色提及新写尚未启用，请保留草稿', HttpStatus.CONFLICT);
}
/** 仅作用于输出副本；原始源码/快照禁止以降级结果回写。 */
export function accountMentionFallback(content: string, names: Map<string, string>): string {
  let result = content;
  for (const token of parseMentionSources(content).filter((row) => row.mode !== 'LEGACY').reverse()) {
    const label = names.get(token.userId) ?? '不可用用户';
    result = result.slice(0, token.start) + `[@${label}](/users/${token.userId})` + result.slice(token.end);
  }
  return result;
}

/** 展示/摘要/档案使用安全副本，源身份只在专门的保源字段中流转。 */
export function displayMentionContent(content: string, entries: Array<{userId:string;label:string;displayName:string;sourceHref?:string}>): string {
  let result = content;
  for (const token of parseMentionSources(content).reverse()) {
    const entry = entries.find(row => row.label === token.label && (row.sourceHref ?? `/users/${row.userId}`) === token.sourceHref);
    if (!entry) continue;
    result = result.slice(0, token.start) + `[@${entry.displayName}](/users/${token.userId})` + result.slice(token.end);
  }
  return result;
}
