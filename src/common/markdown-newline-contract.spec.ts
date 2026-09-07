import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findUnsupportedMarkdownFormats,
  hasVisibleMarkdownContent,
  normalizeMarkdownContent,
} from './markdown-content';

const fixture = JSON.parse(readFileSync(resolve(__dirname,
  '../../contracts/markdown-editor-newline-v1-fixtures.json'), 'utf8')) as {
  cases: Array<{ id: string; markdown: string; lines: string[] }>;
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
