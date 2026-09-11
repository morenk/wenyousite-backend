import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeMarkdownBlockBoundaries } from './markdown-block-boundaries';
import { findUnsupportedMarkdownFormats, normalizeMarkdownContent } from './markdown-content';

type Block = { type: string; text?: string; start?: number; children?: Block[] };
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/markdown-editor-list-v1-fixtures.json'), 'utf8')) as {
  documentCases: Array<{ id: string; markdown: string; tree: Block[]; operations: Array<{ path: number[]; text: string }> }>;
};

// 预期来自独立手写组合树；实际由服务端真实协议解析器读取，包含列表外的空段。
function readDocument(markdown: string): Block[] {
  const root: Block = { type: 'doc', children: [] };
  const stack = [root];
  for (const token of analyzeMarkdownBlockBoundaries(markdown).tokens) {
    const type = ({ paragraph_open: 'paragraph', heading_open: `heading-${token.tag.slice(1)}`,
      bullet_list_open: 'bullet-list', ordered_list_open: 'ordered-list', list_item_open: 'list-item',
      blockquote_open: 'blockquote' } as Record<string, string>)[token.type];
    if (type) {
      const node: Block = { type, ...(['paragraph', 'heading-2', 'heading-3'].includes(type) ? { text: '' } : { children: [] }),
        ...(type === 'ordered-list' ? { start: Number(token.attrGet('start') ?? 1) } : {}) };
      stack.at(-1)!.children!.push(node); stack.push(node);
    } else if (token.type.endsWith('_close')) {
      const node = stack.pop()!;
      if (['list-item', 'blockquote'].includes(node.type) && !node.children!.length) node.children!.push({ type: 'paragraph', text: '' });
    } else if (token.type === 'inline') {
      stack.at(-1)!.text = (token.children ?? []).map(child => child.type === 'text' ? child.content : child.type === 'softbreak' ? '\n' : '').join('');
    } else if (token.meta?.emptyRow) stack.at(-1)!.children!.push({ type: 'paragraph', text: '' });
  }
  return root.children!;
}

describe('列表与文档空块组合独立阅读契约', () => {
  it('穷举两组类型、末项空状态和一至三个空行', () => {
    expect(fixture.documentCases.filter(item => item.id.startsWith('groups-'))).toHaveLength(48);
    expect(new Set(fixture.documentCases.map(item => item.id)).size).toBe(fixture.documentCases.length);
  });
  it.each(fixture.documentCases)('$id 完整正文树与直属空行符合独立预期', item => {
    expect(normalizeMarkdownContent(item.markdown)).toBe(item.markdown);
    expect(findUnsupportedMarkdownFormats(item.markdown)).toEqual([]);
    expect(readDocument(item.markdown)).toEqual(item.tree);
    for (const operation of item.operations) {
      let node: Block = { type: 'doc', children: item.tree };
      for (const index of operation.path) node = node.children![index];
      expect(typeof node.text).toBe('string');
    }
  });
});
