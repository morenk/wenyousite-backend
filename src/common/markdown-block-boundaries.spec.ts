import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeMarkdownBlockBoundaries,
  stripMarkdownAlignmentMetadata,
} from './markdown-block-boundaries';
import {
  findUnsupportedMarkdownFormats,
  literalizeUnsupportedMarkdown,
  markdownContributionText,
  normalizeMarkdownContent,
  prepareMarkdownContent,
} from './markdown-content';
import { truncateMarkdownToCompactPlainText } from './markdown-truncate';

interface Block {
  type: string;
  alignment: string;
  startLine: number;
  endLine: number;
  markerLine: number | null;
  lines: string[];
}
const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../contracts/markdown-block-boundary-v1-fixtures.json'),
    'utf8',
  ),
) as {
  cases: Array<{
    id: string;
    markdown: string;
    supported: boolean;
    blocks: Block[] | null;
    lines: string[] | null;
    lineAlignments: string[] | null;
    error: unknown;
    serialized: string | null;
  }>;
  editCases: Array<{
    id: string;
    markdown: string;
    serialized: string;
    lines: string[];
    lineAlignments: string[];
  }>;
  clipboardCases: Array<{ id: string; markdown: string; serialized: string; plainText: string }>;
  whitespaceCases: Array<{ id: string; markdown: string; serialized: string }>;
};

function project(source: string): Block[] {
  const { tokens, boundaries } = analyzeMarkdownBlockBoundaries(source);
  return tokens.flatMap((token, index) => {
    if (token.level !== 0 || !token.map || token.type === 'alignment_marker') return [];
    const boundary = boundaries.find((item) => item.startLine === token.map![0]);
    let type = (
      {
        paragraph_open: 'paragraph',
        bullet_list_open: 'bullet-list',
        ordered_list_open: 'ordered-list',
        blockquote_open: 'blockquote',
        hr: token.meta?.emptyRow ? 'empty-paragraph' : 'horizontal-rule',
        heading_open: `heading-${token.tag.slice(1)}`,
      } as Record<string, string>
    )[token.type];
    const inline = tokens[index + 1];
    if (
      type === 'paragraph' &&
      inline?.children?.length === 1 &&
      inline.children[0].type === 'image'
    )
      type = 'image';
    const content = tokens
      .filter(
        (item) =>
          item.type === 'inline' &&
          item.map &&
          item.map[0] >= token.map![0] &&
          item.map[1] <= token.map![1],
      )
      .map((item) =>
        (item.children ?? [])
          .map((child) => {
            if (child.type === 'text' || child.type === 'code_inline') return child.content;
            if (child.type === 'softbreak') return '\n';
            if (child.type === 'image') return '[图片]';
            return '';
          })
          .join(''),
      )
      .join('\n');
    const lines = type === 'empty-paragraph' ? [''] : content ? content.split('\n') : [];
    return [
      {
        type,
        alignment: boundary?.alignment ?? 'left',
        startLine: token.map[0],
        endLine: token.map[1] - 1,
        markerLine: boundary?.markerLine ?? null,
        lines,
      },
    ];
  });
}
const semantics = (blocks: Block[]) =>
  blocks.map(({ type, alignment, lines }) => ({ type, alignment, lines }));

describe('真实解析器消费共享块边界 v1', () => {
  it('大量独立代码片段不反复枚举无关的后缀闭合符', () => {
    const count = 100;
    const source = Array<string>(count).fill('`a`').join(' ');
    const matchAll = String.prototype.matchAll;
    let visitedRuns = 0;
    const spy = jest.spyOn(String.prototype, 'matchAll').mockImplementation(function (
      this: string,
      pattern: RegExp,
    ) {
      const matches = matchAll.call(this, pattern);
      if (pattern.source !== '`+') return matches;
      return (function* () {
        for (const match of matches) {
          visitedRuns++;
          yield match;
        }
      })();
    });
    try {
      const analysis = analyzeMarkdownBlockBoundaries(source);
      expect(
        analysis.tokens
          .find((token) => token.type === 'inline')
          ?.children?.filter((token) => token.type === 'code_inline'),
      ).toHaveLength(count);
      // 原始解析与安全空段解析各检查一次，每个片段只访问自己的闭合符。
      expect(visitedRuns).toBeLessThanOrEqual(count * 2);
    } finally {
      spy.mockRestore();
    }
  });
  it.each(fixture.cases)('$id', (item) => {
    expect(findUnsupportedMarkdownFormats(item.markdown)[0] ?? null).toEqual(item.error);
    if (!item.supported) {
      const literal = literalizeUnsupportedMarkdown(item.markdown);
      expect(findUnsupportedMarkdownFormats(literal)).toEqual([]);
      expect(literalizeUnsupportedMarkdown(literal)).toBe(literal);
      return;
    }
    expect(prepareMarkdownContent(item.markdown)).toBe(normalizeMarkdownContent(item.markdown));
    const blocks = project(item.markdown);
    expect(blocks).toEqual(item.blocks);
    expect(blocks.flatMap((block) => block.lines)).toEqual(item.lines);
    expect(blocks.flatMap((block) => block.lines.map(() => block.alignment))).toEqual(
      item.lineAlignments,
    );
    expect(prepareMarkdownContent(item.serialized!)).toBe(item.serialized);
    expect(semantics(project(item.serialized!))).toEqual(semantics(blocks));
  });
  it.each(fixture.editCases)('$id 编辑目标保存/重开语义', (item) => {
    expect(findUnsupportedMarkdownFormats(item.markdown)).toEqual([]);
    expect(prepareMarkdownContent(item.serialized)).toBe(item.serialized);
    const blocks = project(item.serialized);
    expect(blocks.flatMap((block) => block.lines)).toEqual(item.lines);
    expect(blocks.flatMap((block) => block.lines.map(() => block.alignment))).toEqual(
      item.lineAlignments,
    );
  });
  it.each(fixture.clipboardCases)('$id 摘要不泄漏隐藏标记', (item) => {
    expect(truncateMarkdownToCompactPlainText(item.markdown)).toBe(
      item.plainText.replace(/\s+/gu, ' '),
    );
    expect(markdownContributionText(item.markdown)).toBe(item.plainText.replace(/\s+/gu, ' '));
  });
  it.each(fixture.whitespaceCases)('$id 原始空格布局不被服务端改写', (item) => {
    expect(prepareMarkdownContent(item.markdown)).toBe(item.serialized);
  });
  it('保留保护区内源码身份且不移动错误行', () => {
    const marker = '[wenyousite-align-v1-center]: #';
    for (const source of [
      '```\n<br />\n' + marker + '\n正文\n```',
      '<div>\n' + marker + '\n## title\n</div>',
      '`代码\n' + marker + '\n正文`',
    ]) {
      expect(analyzeMarkdownBlockBoundaries(source).boundaries).toEqual([]);
      expect(stripMarkdownAlignmentMetadata(source)).toBe(source);
    }
    expect(markdownContributionText('前文\n' + marker + '\n正文')).toBe('前文 正文');
  });
});
