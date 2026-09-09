import MarkdownIt from 'markdown-it';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findUnsupportedMarkdownFormats, normalizeMarkdownContent } from './markdown-content';

type Block = { type: string; lines: string[] };
type Item = { type: string; depth: number; parent: number | null; start: number | null; text: string; empty: boolean; blocks: Block[] };
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/markdown-editor-list-v1-fixtures.json'), 'utf8')) as {
  cases: Array<{ id: string; markdown: string; canonical: string; items: Item[]; editableLines: string[] }>;
  rejected: Array<{ id: string; markdown: string; issue: string }>;
};

// 独立 markdown-it 阅读树核对手写预期；不调用编辑器编解码生成期望。
function readItems(source: string): Item[] {
  const items: Item[] = [];
  const lists: Array<{ type: string; start: number | null }> = [];
  const parents: number[] = [];
  let block = 'paragraph';
  for (const token of new MarkdownIt().parse(source, {})) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push({ type: token.type === 'bullet_list_open' ? 'bullet' : 'ordered', start: token.type === 'bullet_list_open' ? null : Number(token.attrGet('start') ?? 1) });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
    else if (token.type === 'list_item_open') {
      items.push({ ...lists.at(-1)!, depth: lists.length - 1, parent: parents.at(-1) ?? null, text: '', empty: true, blocks: [] });
      parents.push(items.length - 1);
    } else if (token.type === 'list_item_close') parents.pop();
    else if (token.type === 'heading_open') block = `heading-${token.tag.slice(1)}`;
    else if (token.type === 'paragraph_open') block = 'paragraph';
    else if (token.type === 'inline' && parents.length) {
      const text = (token.children ?? []).map((child) => child.type === 'softbreak' ? '\n' : child.type === 'text' || child.type === 'code_inline' ? child.content : '').join('');
      items[parents.at(-1)!].blocks.push({ type: block, lines: text.split('\n') });
    }
  }
  for (const item of items) {
    if (!item.blocks.length) item.blocks.push({ type: 'paragraph', lines: [''] });
    item.text = item.blocks.flatMap((b) => b.lines).join('\n');
    item.empty = item.text === '';
  }
  return items;
}

describe('列表树与空项 v1 契约', () => {
  it('case id 唯一，覆盖类型和空项组合', () => {
    expect(new Set(fixture.cases.map((c) => c.id)).size).toBe(fixture.cases.length);
    expect(fixture.cases.filter((c) => c.id.startsWith('chain-'))).toHaveLength(84);
  });
  it.each(fixture.cases)('$id 的原文与 canonical 均保持独立阅读树', ({ markdown, canonical, items, editableLines }) => {
    for (const source of [markdown, canonical]) {
      expect(normalizeMarkdownContent(source)).toBe(source);
      expect(findUnsupportedMarkdownFormats(source)).toEqual([]);
      const actual = readItems(source);
      expect(actual).toEqual(items);
      expect(actual.flatMap((i) => i.blocks.flatMap((b) => b.lines))).toEqual(editableLines);
    }
  });
  it.each(fixture.rejected)('$id 不扩大结构白名单', ({ markdown, issue }) => {
    expect(findUnsupportedMarkdownFormats(markdown).map((i) => i.type)).toContain(issue);
  });
});
