import { isTextFontId, isTextFontSourceReady } from './text-font-catalog';
import { analyzeMarkdownBlockBoundaries } from './markdown-block-boundaries';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './exceptions/business.exception';
import { ErrorCode } from './exceptions/error-codes';
import { parseInternalReference, formatInternalReferencePreview } from './internal-reference';
import { maskMentionCode, parseMentionSources } from './role-mentions';

export const TEXT_COLOR_VERSION = 1;
export const TEXT_COLOR_HEADER = 'X-Text-Color-Version';
export const TEXT_FONT_VERSION = 1;
export const TEXT_FONT_V2_VERSION = 2;
export const TEXT_FONT_HEADER = 'X-Text-Font-Version';
const STYLE_ATTRIBUTE = / data-wenyou-(color-v1|font-v1|font-v2)="([^"<>]*)"/gu;
type Style = { color?: string; fontId?: string; fontVersion?: 2 };
type RemoveStyle = 'color' | 'font' | 'font-v2' | 'all';
function withoutStyle(style: Style, remove: RemoveStyle): Style {
  const copy = { ...style };
  if (remove === 'color' || remove === 'all') delete copy.color;
  if (remove === 'font' || remove === 'all' || (remove === 'font-v2' && copy.fontVersion === 2)) {
    delete copy.fontId;
    delete copy.fontVersion;
  }
  return copy;
}
function opening(tag: string): Style | undefined {
  if (!tag.startsWith('<span ') || !tag.endsWith('>')) return;
  const attributes = tag.slice(5, -1);
  const matches = [...attributes.matchAll(STYLE_ATTRIBUTE)];
  if (!matches.length || matches.map((match) => match[0]).join('') !== attributes) return;
  const result: Style = {};
  for (const match of matches) {
    if (match[1] === 'color-v1') {
      if (result.color || !/^#[0-9a-fA-F]{6}$/u.test(match[2])) return;
      result.color = match[2].toUpperCase();
    } else {
      const dynamic = match[1] === 'font-v2';
      if (result.fontId || !(dynamic ? /^tfv_[a-f0-9]{32}$/u : /^[a-z][a-z0-9-]{0,63}$/u).test(match[2])) return;
      result.fontId = match[2];
      if (dynamic) result.fontVersion = 2;
    }
  }
  return result;
}
function openingTag(style: Style): string {
  return (
    '<span' +
    (style.fontId ? ` data-wenyou-font-v${style.fontVersion ?? 1}="${style.fontId}"` : '') +
    (style.color ? ` data-wenyou-color-v1="${style.color}"` : '') +
    '>'
  );
}
const parser = new MarkdownIt({ html: true, linkify: false, typographer: false });
const tokenize = parser.inline.tokenize;
parser.inline.tokenize = function (state) {
  const push = state.push;
  state.push = function (type, tag, nesting) {
    const token = push.call(this, type, tag, nesting);
    if (type === 'html_inline') token.meta = { sourceStart: this.pos };
    return token;
  };
  try {
    tokenize.call(this, state);
  } finally {
    state.push = push;
  }
};
export interface TextStyleRange {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  color?: string;
  fontId?: string;
  fontVersion?: 2;
  content: string;
}
function invalid(font = false): never {
  throw new BusinessException(
    font ? ErrorCode.INVALID_TEXT_FONT : ErrorCode.INVALID_TEXT_COLOR,
    font
      ? '文字字体格式不合法，请保留正文并重新选择字体'
      : '文字颜色格式不合法，请保留正文并重新选择颜色',
    HttpStatus.BAD_REQUEST,
  );
}
function escaped(source: string, offset: number) {
  let count = 0;
  for (let i = offset - 1; i >= 0 && source[i] === '\\'; i--) count++;
  return count % 2 === 1;
}
function validateInner(content: string): boolean {
  if (!content || /[\r\n]/u.test(content)) return false;
  const children = parser.parseInline(content, {})[0].children ?? [];
  for (const token of children) {
    if (
      token.type === 'html_inline' ||
      token.type === 'image' ||
      token.type === 'softbreak' ||
      token.type === 'hardbreak'
    )
      return false;
    if (token.type === 'link_open') {
      const href = token.attrGet('href') ?? '';
      if (
        parseInternalReference(href) ||
        /^\/users(?:\/|$)/u.test(href) ||
        /wenyousite-(?:audio|sticker):/u.test(token.attrGet('title') ?? '')
      )
        return false;
    }
  }
  const masked = maskMentionCode(content);
  if (formatInternalReferencePreview(masked) !== masked) return false;
  for (const match of masked.matchAll(/\[\[dice:v\d+:|@全体玩家/gu)) {
    if (!escaped(content, match.index!)) return false;
  }
  return true;
}
/** 真实 Markdown token 确定文字样式边界；代码、转义、URL/title 不扫描为标签。 */
export function parseTextStyles(source: string, strict = false): TextStyleRange[] {
  if (!/data-wenyou-(?:color|font)/iu.test(source)) return [];
  const lines = source.split('\n'),
    offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  const result: TextStyleRange[] = [];
  const fail = () => {
    if (strict) invalid(/data-wenyou-font/iu.test(source));
  };
  // 与正文验证共享受控空段/对齐边界，避免 <br /> 吞并紧邻样式块。
  for (const block of analyzeMarkdownBlockBoundaries(source).tokens) {
    if (block.type === 'html_block' && /data-wenyou-(?:color|font)/iu.test(block.content)) {
      fail();
      continue;
    }
    if (block.type !== 'inline' || !block.map) continue;
    const inlineLines = block.content.split('\n'),
      relativeOffsets: number[] = [],
      absoluteLines: number[] = [];
    let relative = 0;
    inlineLines.forEach((line, i) => {
      relativeOffsets.push(relative);
      relative += line.length + 1;
      const row = block.map![0] + i;
      absoluteLines.push(offsets[row] + lines[row].lastIndexOf(line));
    });
    const absolute = (position: number) => {
      let row = 0;
      while (row + 1 < relativeOffsets.length && relativeOffsets[row + 1] <= position) row++;
      return absoluteLines[row] + position - relativeOffsets[row];
    };
    let active: ({ start: number; contentStart: number } & Style) | undefined;
    for (const token of block.children ?? []) {
      if (token.type === 'text' && /data-wenyou-(?:color|font)/iu.test(token.content)) {
        // 普通字面内容只允许显式转义的标签；残缺或未知版本不得被当作成功格式保存。
        const position = block.content.indexOf(token.content);
        if (
          position >= 0 &&
          token.content.includes('<span') &&
          !escaped(block.content, position + token.content.indexOf('<span'))
        )
          fail();
      }
      if (token.type !== 'html_inline') continue;
      const position = absolute(token.meta.sourceStart as number);
      const open = opening(token.content);
      if (open) {
        if (active || token.level !== 0 || (strict && open.fontId && open.fontVersion !== 2 && !isTextFontId(open.fontId))) {
          fail();
          active = undefined;
          continue;
        }
        active = {
          start: position,
          contentStart: position + token.content.length,
          ...open,
        };
      } else if (token.content === '</span>' && active) {
        const content = source.slice(active.contentStart, position);
        if (token.level !== 0 || !validateInner(content)) {
          fail();
          active = undefined;
          continue;
        }
        result.push({
          ...active,
          contentEnd: position,
          end: position + token.content.length,
          content,
        });
        active = undefined;
      } else if (active || /data-wenyou-(?:color|font)/iu.test(token.content)) {
        fail();
        active = undefined;
      }
    }
    if (active) fail();
  }
  return result;
}
export type TextColorRange = TextStyleRange & { color: string };
export type TextFontRange = TextStyleRange & { fontId: string };
export const parseTextColors = (source: string, strict = false): TextColorRange[] =>
  parseTextStyles(source, strict).filter((range): range is TextColorRange => !!range.color);
export const parseTextFonts = (source: string, strict = false): TextFontRange[] =>
  parseTextStyles(source, strict).filter((range): range is TextFontRange => !!range.fontId);

export function normalizeTextColors(source: string): string {
  const ranges = parseTextStyles(source, true);
  let output = source;
  for (const range of ranges.reverse()) {
    output = output.slice(0, range.start) + openingTag(range) + output.slice(range.contentStart);
  }
  return output;
}
const escapeText = (value: string) => value.replace(/[!-/:-@[-`{-~]/gu, '\\$&');
const escapeDestination = (value: string) =>
  Array.from(value)
    .map((character) =>
      ['(', ')', String.fromCharCode(92)].includes(character)
        ? String.fromCharCode(92) + character
        : character,
    )
    .join('');
const escapeTitle = (value: string) =>
  Array.from(value)
    .map((character) =>
      ['"', String.fromCharCode(92)].includes(character)
        ? String.fromCharCode(92) + character
        : character,
    )
    .join('');
/** 将内联 token 转回安全 Markdown，避免去掉 span 后把字面 #、>、* 等激活为语法。 */
function fallbackInline(content: string, remove: RemoveStyle): string {
  let marker = '\uE090';
  while (content.includes(marker)) marker += '\uE090';
  const atoms = parseMentionSources(content).map(({ start, end }) => ({ start, end }));
  const masked = maskMentionCode(content);
  formatInternalReferencePreview(masked, {
    onReference: (candidate, start) => atoms.push({ start, end: start + candidate.length }),
  });
  for (const match of masked.matchAll(
    /\[\[dice:v1:[0-9a-f-]{36}:[^\]\r\n]{1,32}\]\]|@全体玩家/giu,
  )) {
    if (!escaped(content, match.index!))
      atoms.push({ start: match.index!, end: match.index! + match[0].length });
  }
  atoms.sort((left, right) => left.start - right.start);
  const unique = atoms.filter((atom, index) => index === 0 || atom.start >= atoms[index - 1].end);
  let protectedContent = content;
  for (let i = unique.length - 1; i >= 0; i--) {
    const atom = unique[i];
    protectedContent =
      protectedContent.slice(0, atom.start) + `${marker}${i}END` + protectedContent.slice(atom.end);
  }
  let retained = false;
  const children = (parser.parseInline(protectedContent, {})[0].children ?? []).filter((token) => {
    if (token.type !== 'html_inline') return true;
    const originalStyle = opening(token.content);
    if (originalStyle) {
      const style = withoutStyle(originalStyle, remove);
      retained = !!(style.color || style.fontId);
      if (retained) token.content = openingTag(style);
      return retained;
    }
    if (token.content === '</span>') {
      const keep = retained;
      retained = false;
      return keep;
    }
    return true;
  });
  const tokens: Token[] = [];
  for (const token of children) {
    if (token.type === 'text' && !token.content) continue;
    const previous = tokens.at(-1);
    if (previous?.type === 'code_inline' && token.type === 'code_inline') {
      previous.content += token.content;
    } else if (
      previous?.nesting === -1 &&
      token.nesting === 1 &&
      ['em', 'strong', 's'].some(
        (kind) => previous.type === `${kind}_close` && token.type === `${kind}_open`,
      )
    ) {
      tokens.pop();
    } else tokens.push(token);
  }
  const render = (alternate = false) => {
    const links: Token[] = [];
    return tokens
      .map((token) => {
        if (token.type === 'text') {
          if (!alternate || !token.content) return escapeText(token.content);
          const chars = Array.from(token.content);
          return chars
            .map((character, index) =>
              index === 0 || index === chars.length - 1
                ? `&#${character.codePointAt(0)};`
                : escapeText(character),
            )
            .join('');
        }
        if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n';
        if (token.type === 'code_inline') {
          const delimiter = '`'.repeat(
            Math.max(1, ...[...token.content.matchAll(/`+/gu)].map((match) => match[0].length + 1)),
          );
          const pad =
            token.content.startsWith('`') ||
            token.content.endsWith('`') ||
            /^ .+ $/u.test(token.content)
              ? ' '
              : '';
          return delimiter + pad + token.content + pad + delimiter;
        }
        if (token.type === 'link_open') {
          links.push(token);
          return '[';
        }
        if (token.type === 'link_close') {
          const open = links.pop()!;
          const href = escapeDestination(open.attrGet('href') ?? '');
          const title = open.attrGet('title');
          return `](${href}${title === null ? '' : ` "${escapeTitle(title)}"`})`;
        }
        if (token.type === 'image') {
          const src = escapeDestination(token.attrGet('src') ?? '');
          const title = token.attrGet('title');
          return `![${escapeText(token.content)}](${src}${title === null ? '' : ` "${escapeTitle(title)}"`})`;
        }
        if (token.type.startsWith('em_')) return alternate ? '_' : '*';
        if (token.type.startsWith('strong_')) return '**';
        if (token.type.startsWith('s_')) return '~~';
        return token.type === 'html_inline'
          ? opening(token.content) || token.content === '</span>'
            ? token.content
            : escapeText(token.content)
          : token.markup;
      })
      .join('')
      .replace(/^ +| +$/gmu, (spaces) => '&#32;'.repeat(spaces.length));
  };
  let output = render();
  // 三段粗斜体切换可能形成歧义星号串；下划线搭配文本边界实体避免重新配对。
  if (JSON.stringify(colorLeaves(protectedContent)) !== JSON.stringify(colorLeaves(output)))
    output = render(true);
  for (let i = 0; i < unique.length; i++)
    output = output.replace(`${marker}${i}END`, content.slice(unique[i].start, unique[i].end));
  return output;
}
/** 整个内联流去除样式后重序列化，避免 span 边界移除后合并分隔符造成格式损失。 */
export function stripTextStyles(source: string, remove: RemoveStyle = 'all'): string {
  const ranges = parseTextStyles(source).filter(
    (range) => remove === 'all' || (remove === 'font-v2' ? range.fontVersion === 2 : remove === 'font' ? range.fontId : range.color),
  );
  if (!ranges.length) return source;
  // 仍保留另一种样式时边界没有消失，仅替换开标签，保持内部字面标点原样。
  if (
    remove !== 'all' &&
    ranges.every((range) => { const retained = withoutStyle(range, remove); return retained.color || retained.fontId; })
  ) {
    let output = source;
    for (const range of ranges.toReversed()) {
      const style = withoutStyle(range, remove);
      output = output.slice(0, range.start) + openingTag(style) + output.slice(range.contentStart);
    }
    return output;
  }
  const lines = source.split('\n'),
    offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  const edits: Array<{ start: number; end: number; value: string }> = [];
  // 对齐协议行会终止前一个段落；按同一块边界去除样式，避免把它序列化成字面标点。
  for (const block of analyzeMarkdownBlockBoundaries(source).tokens) {
    if (block.type !== 'inline' || !block.map) continue;
    const start = offsets[block.map[0]],
      end = offsets[block.map[1]] ?? source.length;
    if (!ranges.some((range) => range.start >= start && range.end <= end)) continue;
    const original = block.content.split('\n'),
      fallback = fallbackInline(block.content, remove).split('\n');
    original.forEach((line, i) => {
      const row = block.map![0] + i,
        column = lines[row].lastIndexOf(line);
      edits.push({
        start: offsets[row] + column,
        end: offsets[row] + column + line.length,
        value: fallback[i],
      });
    });
  }
  let output = source;
  for (const edit of edits.reverse())
    output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  return output;
}
/** 校验时仅以不可见字符占位已验证的标签，禁止降级序列化吞掉旁边非法 HTML。 */
export function maskTextColorTags(source: string): string {
  let output = source;
  for (const range of parseTextStyles(source, true).reverse()) {
    output =
      output.slice(0, range.start) + '\u2060' + range.content + '\u2060' + output.slice(range.end);
  }
  return output;
}
export const stripTextColors = (source: string): string => stripTextStyles(source, 'color');
export const stripTextFonts = (source: string): string => stripTextStyles(source, 'font');

type ColorLeaf = { text: string; marks: string[] };
/** 只签名已验证的内联语义；语法分隔符和实体编码不改变保存能力。 */
function colorLeaves(content: string): ColorLeaf[] {
  const marks: string[] = [],
    leaves: ColorLeaf[] = [];
  for (const token of parser.parseInline(content, {})[0].children ?? []) {
    if (token.nesting === 1) marks.push(JSON.stringify([token.type, token.attrs ?? []]));
    if (token.nesting === -1) marks.pop();
    if ((token.type !== 'text' && token.type !== 'code_inline') || !token.content) continue;
    const leafMarks = [...marks, ...(token.type === 'code_inline' ? ['code_inline'] : [])].sort();
    const previous = leaves.at(-1);
    if (previous && JSON.stringify(previous.marks) === JSON.stringify(leafMarks))
      previous.text += token.content;
    else leaves.push({ text: token.content, marks: leafMarks });
  }
  return leaves;
}
function colorSignatures(ranges: TextColorRange[]): string[] {
  const groups: Array<{ color: string; end: number; leaves: ColorLeaf[] }> = [];
  for (const range of ranges) {
    const leaves = colorLeaves(range.content),
      previous = groups.at(-1);
    if (previous && previous.end === range.start && previous.color === range.color) {
      for (const leaf of leaves) {
        const last = previous.leaves.at(-1);
        if (last && JSON.stringify(last.marks) === JSON.stringify(leaf.marks))
          last.text += leaf.text;
        else previous.leaves.push(leaf);
      }
      previous.end = range.end;
    } else groups.push({ color: range.color, end: range.end, leaves });
  }
  return groups.map((group) => JSON.stringify([group.color, group.leaves]));
}
export function assertTextColorWrite(
  content: string,
  previous = '',
  version?: number,
  enabled = false,
): void {
  const next = parseTextColors(content, true),
    old = parseTextColors(previous);
  if (!next.length && !old.length) return;
  if (version !== TEXT_COLOR_VERSION)
    throw new BusinessException(
      ErrorCode.TEXT_COLOR_CAPABILITY_REQUIRED,
      '正文包含自定义颜色，请保留草稿并升级编辑器',
      HttpStatus.CONFLICT,
    );
  if (enabled) return;
  const saved = new Map<string, number>();
  for (const key of colorSignatures(old)) saved.set(key, (saved.get(key) ?? 0) + 1);
  for (const key of colorSignatures(next)) {
    const count = saved.get(key) ?? 0;
    if (!count)
      throw new BusinessException(
        ErrorCode.TEXT_COLOR_DISABLED,
        '自定义颜色新写尚未启用，请保留草稿',
        HttpStatus.CONFLICT,
      );
    saved.set(key, count - 1);
  }
}
function requireTextFontCapability(version: number | undefined, dynamic = false): void {
  if (version !== 2 && (dynamic || version !== TEXT_FONT_VERSION))
    throw new BusinessException(
      ErrorCode.TEXT_FONT_CAPABILITY_REQUIRED,
      '正文包含自定义字体，请保留草稿并升级编辑器',
      HttpStatus.CONFLICT,
    );
}
export function assertTextFontCapability(content: string, version?: number): void {
  const ranges = parseTextFonts(content, true);
  if (ranges.length) requireTextFontCapability(version, ranges.some((range) => range.fontVersion === 2));
}
export function assertTextFontWrite(
  content: string,
  previous = '',
  version?: number,
  enabled = false,
  allowedDynamicVersions: ReadonlySet<string> = new Set(),
): void {
  const next = parseTextFonts(content, true),
    old = parseTextFonts(previous);
  if (!next.length && !old.length) return;
  requireTextFontCapability(version, [...next, ...old].some((range) => range.fontVersion === 2));
  const writable = (range: TextFontRange) => range.fontVersion === 2
    ? allowedDynamicVersions.has(range.fontId)
    : enabled && isTextFontSourceReady(range.fontId);
  if (next.every(writable)) return;
  const signatures = (ranges: TextFontRange[]) =>
    colorSignatures(ranges.map((range) => ({ ...range, color: `v${range.fontVersion ?? 1}:${range.fontId}` })));
  const saved = new Map<string, number>();
  for (const key of signatures(old)) saved.set(key, (saved.get(key) ?? 0) + 1);
  for (const key of signatures(
    next.filter((range) => !writable(range)),
  )) {
    const count = saved.get(key) ?? 0;
    if (!count)
      throw new BusinessException(
        ErrorCode.TEXT_FONT_DISABLED,
        '自定义字体新写尚未启用，请保留草稿',
        HttpStatus.CONFLICT,
      );
    saved.set(key, count - 1);
  }
}
export function projectTextFonts(value: unknown, version?: number): void {
  if (version === TEXT_FONT_V2_VERSION || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => projectTextFonts(item, version));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (['content', 'sourceContent', 'bodyContent'].includes(key) && typeof child === 'string')
      record[key] = stripTextStyles(child, version === 1 ? 'font-v2' : 'font');
    else if (child && typeof child === 'object') projectTextFonts(child, version);
  }
}
/** 与媒体/身份投影共用已隔离的响应副本；仅处理正文与保源字段。 */
export function projectTextColors(value: unknown, version?: number): void {
  if (version === TEXT_COLOR_VERSION || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => projectTextColors(item, version));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (['content', 'sourceContent', 'bodyContent'].includes(key) && typeof child === 'string')
      record[key] = stripTextColors(child);
    else if (child && typeof child === 'object') projectTextColors(child, version);
  }
}

/** 动态、私信、管理审计等纯文本响应不参与主题 Markdown 能力降级。 */
export function isTextColorResponseRoute(route: string): boolean {
  const path = route.replace(/^\/api\/v\d+/, '');
  return (
    /^\/(?:threads|subthreads|posts|drafts)(?:\/|$)/u.test(path) ||
    /^\/search(?:\/(?:threads|posts))?$/u.test(path) ||
    /^\/users\/[^/]+\/(?:posts|recent-replies)(?:\/|$)/u.test(path)
  );
}
