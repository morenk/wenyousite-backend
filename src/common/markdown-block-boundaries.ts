import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export const ALIGNMENT_MARKER_RE = /^\[wenyousite-align-v1-(center|right)\]: #$/u;
const EMPTY_ROW_RE = /^ {0,3}<br\s*\/?>[\t ]*$/iu;
const QUOTED_EMPTY_ROW_RE = /^ {0,3}>[\t ]?<br\s*\/?>[\t ]*$/iu;
const parserOptions = { html: true, linkify: true, typographer: false };
const rawParser = new MarkdownIt(parserOptions);
const ordinaryParser = new MarkdownIt(parserOptions);
const boundaryParser = new MarkdownIt(parserOptions);

// 只记录真实 inline 规则消费的代码起点。URL/title 中的反引号不会生成 code_inline。
for (const parser of [rawParser, ordinaryParser]) {
  const tokenizeInline = parser.inline.tokenize;
  parser.inline.tokenize = function (state) {
    const push = state.push;
    state.push = function (type, tag, nesting) {
      const token = push.call(this, type, tag, nesting);
      if (type === 'code_inline') token.meta = { sourceStart: this.pos };
      return token;
    };
    try {
      tokenizeInline.call(this, state);
    } finally {
      state.push = push;
    }
  };
}

for (const parser of [ordinaryParser, boundaryParser]) {
  parser.block.ruler.before(
    'html_block',
    'empty_row',
    (state, line, _end, silent) => {
      const env = state.env as BoundaryEnvironment;
      if (env.protectedLines?.has(line)) return false;
      const rawLine = env.lines[line];
      if (
        !(state.level === 0 && EMPTY_ROW_RE.test(rawLine)) &&
        !(state.level === 1 && QUOTED_EMPTY_ROW_RE.test(rawLine))
      )
        return false;
      if (silent) return true;
      const token = state.push('hr', 'hr', 0);
      token.map = [line, line + 1];
      token.meta = { emptyRow: true };
      state.line = line + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote'] },
  );
}

export interface MarkdownAlignmentBoundary {
  alignment: 'center' | 'right';
  markerLine: number;
  startLine: number;
  endLine: number;
  type: 'paragraph' | 'heading-2' | 'heading-3' | 'image';
}

interface BoundaryEnvironment {
  lines: string[];
  protectedLines: Set<number>;
}

// 协议行本身终止前一个块；不插入存储空行，也不改变 token 的原始行号。
boundaryParser.block.ruler.before(
  'reference',
  'alignment_boundary',
  (state, line, _end, silent) => {
    const env = state.env as BoundaryEnvironment;
    if (!ALIGNMENT_MARKER_RE.test(env.lines[line]) || env.protectedLines.has(line)) return false;
    if (silent) return true;
    if (state.level !== 0) return false;
    const token = state.push('alignment_marker', '', 0);
    token.map = [line, line + 1];
    token.content = env.lines[line];
    state.line = line + 1;
    return true;
  },
  { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
);

/** 按真实通用解析结果保护代码/HTML；成对反引号可跨行，偏移使用 UTF-16。 */
function protectedSource(lines: string[]): { protectedLines: Set<number>; maskedLines: string[] } {
  const protectedLines = new Set<number>();
  const maskedLines = [...lines];
  const collect = (tokens: Token[]) => {
    for (const token of tokens) {
      if (!token.map) continue;
      const [start, end] = token.map;
      if (['fence', 'code_block', 'html_block'].includes(token.type)) {
        if (
          token.type === 'html_block' &&
          (EMPTY_ROW_RE.test(lines[start]) || QUOTED_EMPTY_ROW_RE.test(lines[start]))
        )
          continue;
        for (let line = start; line < end; line++) {
          protectedLines.add(line);
          maskedLines[line] = '';
        }
      } else if (
        token.type === 'inline' &&
        token.children?.some((child) => child.type === 'code_inline')
      ) {
        const source = token.content;
        const chars = source.split('');
        for (const child of token.children ?? []) {
          if (child.type !== 'code_inline') continue;
          const offset: number = child.meta.sourceStart;
          let closing: RegExpMatchArray | undefined;
          for (const run of source.slice(offset + child.markup.length).matchAll(/`+/gu)) {
            if (run[0].length !== child.markup.length) continue;
            closing = run;
            break;
          }
          if (!closing) continue;
          const closingEnd = offset + child.markup.length + closing.index! + closing[0].length;
          for (let cursor = offset; cursor < closingEnd; cursor++) {
            if (chars[cursor] !== '\n') chars[cursor] = ' ';
          }
        }
        const masked = chars.join('').split('\n');
        const inlineLines = source.split('\n');
        for (let line = start; line < end; line++) {
          const relative = line - start;
          if (inlineLines[relative] === undefined) continue;
          const column = lines[line].indexOf(inlineLines[relative]);
          if (column < 0) continue;
          maskedLines[line] =
            lines[line].slice(0, column) +
            masked[relative] +
            lines[line].slice(column + inlineLines[relative].length);
          if (maskedLines[line] !== lines[line]) protectedLines.add(line);
        }
      }
    }
  };
  // 先保护原始代码，再隔离安全空段，识别空段后真正的 HTML/代码块。
  collect(rawParser.parse(lines.join('\n'), { lines }));
  collect(ordinaryParser.parse(lines.join('\n'), { lines, protectedLines }));
  return { protectedLines, maskedLines };
}

/** 输入为规范化正文；输出的 map/startLine/endLine 始终是原始零基行号（endLine 含尾行）。 */
export function analyzeMarkdownBlockBoundaries(source: string, markdownContractVersion = 5) {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const { protectedLines, maskedLines } = protectedSource(lines);
  const parsed = boundaryParser.parse(lines.join('\n'), {
    lines,
    protectedLines,
  } satisfies BoundaryEnvironment);
  const tokens: Token[] = [];
  let previousEnd: number | undefined;
  for (const token of parsed) {
    if (token.level === 0 && token.map) {
      // 一个空源码行仅分隔块；额外空行是已有客户端恢复的可见空段。
      if (
        previousEnd !== undefined &&
        lines.slice(previousEnd, token.map[0]).every((value) => !value.trim())
      ) {
        for (let line = previousEnd + 1; line < token.map[0]; line++) {
          const empty = ordinaryParser.parse('<br />', { lines: ['<br />'] })[0];
          empty.map = [line, line + 1];
          tokens.push(empty);
        }
      }
      previousEnd = token.map[1];
    }
    tokens.push(token);
  }
  const boundaries: MarkdownAlignmentBoundary[] = [];
  const markerLines = new Set<number>();
  const invalidMarkerLines: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const marker = tokens[index];
    if (marker.type !== 'alignment_marker' || !marker.map) continue;
    const line = marker.map[0];
    markerLines.add(line);
    const target = tokens[index + 1];
    const inline = tokens[index + 2];
    const type = eligibleTarget(target, inline, markdownContractVersion);
    if (!type || target.map?.[0] !== line + 1) {
      invalidMarkerLines.push(line);
      continue;
    }
    boundaries.push({
      alignment: marker.content.match(ALIGNMENT_MARKER_RE)![1] as 'center' | 'right',
      markerLine: line,
      startLine: target.map[0],
      endLine: target.map[1] - 1,
      type,
    });
  }
  return { tokens, boundaries, markerLines, invalidMarkerLines, protectedLines, maskedLines };
}

function eligibleTarget(
  target: Token | undefined,
  inline: Token | undefined,
  version: number,
): MarkdownAlignmentBoundary['type'] | null {
  if (!target || target.level !== 0 || inline?.type !== 'inline' || !inline.content.trim())
    return null;
  const children = inline.children ?? [];
  const regularImages = children.filter(
    (child) =>
      child.type === 'image' && !child.attrGet('title')?.startsWith('wenyousite-sticker:v1:'),
  );
  if (target.type === 'paragraph_open') {
    if (!regularImages.length) return 'paragraph';
    if (version >= 5 && children.length === 1 && regularImages.length === 1) return 'image';
  }
  if (target.type === 'heading_open' && !regularImages.length) {
    if (target.tag === 'h2') return 'heading-2';
    if (target.tag === 'h3') return 'heading-3';
  }
  return null;
}

/** 只移除已确认合法的隐藏元数据，保留代码、转义及非法源码的可见身份。 */
export function stripMarkdownAlignmentMetadata(source: string): string {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const hidden = new Set(
    analyzeMarkdownBlockBoundaries(source).boundaries.map((boundary) => boundary.markerLine),
  );
  return lines.filter((_line, index) => !hidden.has(index)).join('\n');
}
