import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt({ html: true });
const tokenize = parser.inline.tokenize;
parser.inline.tokenize = function (state) {
  const push = state.push;
  state.push = function (type, tag, nesting) {
    const token = push.call(this, type, tag, nesting);
    if (type === 'code_inline') token.meta = { sourceStart: this.pos };
    return token;
  };
  try {
    tokenize.call(this, state);
  } finally {
    state.push = push;
  }
};

/** 真实解析定位代码；摘要处理及实体解码结束后才恢复字面内容。 */
export function protectPreviewCode(source: string) {
  const used = new Set(source);
  let markerCodePoint = 0xe100;
  while (used.has(String.fromCodePoint(markerCodePoint))) {
    markerCodePoint++;
    if (markerCodePoint === 0xf900) markerCodePoint = 0xf0000;
  }
  const marker = String.fromCodePoint(markerCodePoint);
  const lines = source.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  const spans: Array<{ start: number; end: number; key: string; text: string }> = [];
  for (const block of parser.parse(source, {})) {
    if (block.type !== 'inline' || !block.map) continue;
    const inlineLines = block.content.split('\n');
    const inlineOffsets: number[] = [];
    const absoluteLines: Array<number | undefined> = [];
    let inlineCursor = 0;
    for (let relative = 0; relative < inlineLines.length; relative++) {
      inlineOffsets.push(inlineCursor);
      inlineCursor += inlineLines[relative].length + 1;
      const line = block.map[0] + relative;
      const column = lines[line].lastIndexOf(inlineLines[relative]);
      absoluteLines.push(column < 0 ? undefined : offsets[line] + column);
    }
    const absoluteOffset = (offset: number) => {
      let low = 0;
      let high = inlineOffsets.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (inlineOffsets[middle] <= offset) low = middle;
        else high = middle;
      }
      return absoluteLines[low] === undefined
        ? undefined
        : absoluteLines[low]! + offset - inlineOffsets[low];
    };
    for (const child of block.children ?? []) {
      if (child.type !== 'code_inline') continue;
      const start: number = child.meta.sourceStart;
      const contentStart = start + child.markup.length;
      const runs = /`+/gu;
      runs.lastIndex = contentStart;
      let closing: RegExpExecArray | null;
      do {
        closing = runs.exec(block.content);
      } while (closing && closing[0].length !== child.markup.length);
      if (!closing) continue;
      const contentEnd = closing.index;
      const absoluteStart = absoluteOffset(start);
      const absoluteEnd = absoluteOffset(contentEnd + child.markup.length);
      if (absoluteStart === undefined || absoluteEnd === undefined) continue;
      let text = block.content.slice(contentStart, contentEnd).replace(/\n/gu, ' ');
      // 依照 CommonMark，纯空格代码不移除 padding；现有解析依赖会误删两格。
      if (/^ .+ $/su.test(text) && /[^ ]/u.test(text)) text = text.slice(1, -1);
      spans.push({
        start: absoluteStart,
        end: absoluteEnd,
        key: `${marker}${spans.length}END`,
        text,
      });
    }
  }
  const parts: string[] = [];
  let sourceCursor = 0;
  for (const span of spans) {
    parts.push(source.slice(sourceCursor, span.start), span.key);
    sourceCursor = span.end;
  }
  parts.push(source.slice(sourceCursor));
  return {
    source: parts.join(''),
    restore: (text: string, transform: (value: string) => string = (value) => value) => {
      const result: string[] = [];
      let cursor = 0;
      for (const match of text.matchAll(new RegExp(`${marker}(\\d+)END`, 'gu'))) {
        result.push(transform(text.slice(cursor, match.index)), spans[Number(match[1])].text);
        cursor = match.index! + match[0].length;
      }
      result.push(transform(text.slice(cursor)));
      return result.join('');
    },
  };
}
