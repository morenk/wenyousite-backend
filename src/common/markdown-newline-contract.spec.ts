import MarkdownIt from 'markdown-it';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findUnsupportedMarkdownFormats,
  hasVisibleMarkdownContent,
  normalizeMarkdownContent,
} from './markdown-content';

const fixture = JSON.parse(readFileSync(resolve(__dirname,
  '../../contracts/markdown-editor-newline-v1-fixtures.json'), 'utf8')) as {
  revision: number;
  cases: Array<{ id: string; markdown: string; lines: string[]; lineAlignments?: string[] }>;
  editCases: Array<{ id: string; markdown: string; serialized: string; lines: string[]; lineAlignments: string[] }>;
  rejected: string[];
};

describe('跨端普通回车与引用空白行契约', () => {
  it.each(fixture.cases)('$id 保留规范正文且可写入', ({ markdown, lines }) => {
    expect(normalizeMarkdownContent(markdown)).toBe(markdown);
    expect(findUnsupportedMarkdownFormats(markdown)).toEqual([]);
    expect(hasVisibleMarkdownContent(markdown)).toBe(lines.some((line) => line.length > 0));
  });
  it.each(fixture.rejected)('仍拒绝非独占或带属性 HTML：%s', (markdown) => {
    expect(findUnsupportedMarkdownFormats(markdown).some((issue) => issue.type === 'raw-html')).toBe(true);
  });
  it('只规范化单层引用中的独占空行标记', () => {
    expect(normalizeMarkdownContent('> <br>\n>\t<br/>\n   > <br >')).toBe('> <br />\n> <br />\n> <br />');
    expect(hasVisibleMarkdownContent('> <br />\n> <br />')).toBe(false);
  });
});


describe('手动 Enter 排版边界 revision 2', () => {
  it('显式修订输入规则，保留 Markdown v5 格式', () => {
    expect(fixture.revision).toBe(2);
    expect(fixture.editCases).toHaveLength(27);
  });
  it.each(fixture.editCases)('$id 的原文与新正文均可安全写入', ({ markdown, serialized }) => {
    for (const value of [markdown, serialized]) {
      expect(normalizeMarkdownContent(value)).toBe(value);
      expect(findUnsupportedMarkdownFormats(value)).toEqual([]);
    }
  });
  it.each([
    ...fixture.cases.filter((item) => item.lineAlignments),
    ...fixture.editCases.map((item) => ({ ...item, markdown: item.serialized })),
  ])('$id 用现有段落结构表达可见行和对齐', ({ markdown, lines, lineAlignments }) => {
    // 隔离安全空行标记，避免 CommonMark HTML 块吞并相邻正文。
    const source = markdown.replace(/^<br \/>$/gm, '\n<br />\n');
    const sourceLines = source.split('\n');
    const actualLines: string[] = [];
    const alignments: string[] = [];
    for (const token of new MarkdownIt({ html: true }).parse(source, {})) {
      if (token.type === 'inline') {
        const alignment = sourceLines[(token.map?.[0] ?? 0) - 1]
          ?.match(/^\[wenyousite-align-v1-(center|right)\]: #$/)?.[1] ?? 'left';
        const rows = token.content.split('\n');
        actualLines.push(...rows);
        alignments.push(...rows.map(() => alignment));
      } else if (token.type === 'html_block') {
        actualLines.push('');
        alignments.push('left');
      }
    }
    expect(actualLines).toEqual(lines);
    expect(alignments).toEqual(lineAlignments);
  });
});
