import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import { prepareMarkdownContent } from './markdown-content';

interface EditCase {
  id: string;
  markdown: string;
  operation: { anchor: string; offset: number; text: string; marks: Record<string, true | string> };
  serialized: string;
  visibleText: string;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../contracts/markdown-editor-roundtrip-v7-fixtures.json'),
    'utf8',
  ),
) as { version: number; editCases: EditCase[] };
const parser = new MarkdownIt();

describe('编辑操作契约的服务端接收与逐段语义', () => {
  it('覆盖全部十五种组合、独立代码和三个插入位置', () => {
    expect(fixture.version).toBe(7);
    expect(new Set(fixture.editCases.map((item) => item.id)).size).toBe(48);
    for (const offset of [0, 1, 2]) {
      const cases = fixture.editCases.filter((item) => item.operation.offset === offset);
      expect(cases).toHaveLength(16);
      expect(new Set(cases.map((item) => JSON.stringify(item.operation.marks))).size).toBe(16);
    }
  });

  it.each(fixture.editCases)('$id 接受原文且整个文本区间保留样式', (item) => {
    expect(prepareMarkdownContent(item.markdown)).toBe(item.markdown);
    expect(prepareMarkdownContent(item.serialized)).toBe(item.serialized);
    const { anchor, offset, text, marks } = item.operation;
    expect(item.visibleText).toBe(anchor.slice(0, offset) + text + anchor.slice(offset));
    const tokens = parser.parse(item.serialized, {});
    expect(tokens[0].type).toBe('paragraph_open');
    const active: Record<string, true | string> = {};
    let visible = '';
    for (const token of tokens.flatMap((block) => block.children ?? [])) {
      const style = ({ strong: 'bold', em: 'italic', s: 'strike', link: 'link' } as const)[
        token.type.replace(/_(open|close)$/, '')
      ];
      if (style && token.type.endsWith('_open'))
        active[style] = style === 'link' ? token.attrGet('href')! : true;
      if (style && token.type.endsWith('_close')) delete active[style];
      if ((token.type === 'text' || token.type === 'code_inline') && token.content) {
        expect({ ...active, ...(token.type === 'code_inline' ? { code: true } : {}) }).toEqual(
          marks,
        );
        visible += token.content;
      }
    }
    expect(visible).toBe(item.visibleText);
  });
});
