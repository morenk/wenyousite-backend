/** Markdown v3 契约测试：以后端纯函数执行跨语言黄金语料。 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorCode } from './exceptions/error-codes';
import {
  assertSupportedMarkdown,
  findUnsupportedMarkdownFormats,
  hasVisibleMarkdownContent,
  literalizeUnsupportedMarkdown,
  normalizeMarkdownContent,
  type UnsupportedMarkdownType,
} from './markdown-content';

interface MarkdownFixtureCase {
  id: string;
  description: string;
  input: string;
  canonical: string;
  visible: boolean;
  supported: boolean;
  unsupportedType: UnsupportedMarkdownType | null;
  literal: string;
}

interface MarkdownFixtureFile {
  contract: string;
  version: number;
  cases: MarkdownFixtureCase[];
}

const fixturePath = resolve(__dirname, '../../contracts/markdown-v3-fixtures.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as MarkdownFixtureFile;

describe('Markdown v3 黄金语料', () => {
  it('协议标识、版本和 case id 合法', () => {
    expect(fixtures.contract).toBe('wenyousite-markdown');
    expect(fixtures.version).toBe(3);
    expect(fixtures.cases.length).toBeGreaterThan(0);
    expect(new Set(fixtures.cases.map((item) => item.id)).size).toBe(fixtures.cases.length);
  });

  it.each(fixtures.cases)('$id 规范化结果一致：$description', ({ input, canonical }) => {
    expect(normalizeMarkdownContent(input)).toBe(canonical);
  });

  it.each(fixtures.cases)('$id 发布可见性一致：$description', ({ canonical, visible }) => {
    expect(hasVisibleMarkdownContent(canonical)).toBe(visible);
  });

  it.each(fixtures.cases)('$id 规范化幂等', ({ canonical }) => {
    expect(normalizeMarkdownContent(canonical)).toBe(canonical);
  });

  it.each(fixtures.cases)('$id 白名单结果一致', ({ canonical, supported, unsupportedType }) => {
    const first = findUnsupportedMarkdownFormats(canonical)[0];
    expect(first?.type ?? null).toBe(unsupportedType);
    if (supported) {
      expect(() => assertSupportedMarkdown(canonical)).not.toThrow();
    } else {
      expect(() => assertSupportedMarkdown(canonical)).toThrow(
        expect.objectContaining({ errorCode: ErrorCode.UNSUPPORTED_MARKDOWN_FORMAT }),
      );
    }
  });

  it.each(fixtures.cases)('$id 字面降级稳定且自身合法', ({ canonical, literal }) => {
    expect(literalizeUnsupportedMarkdown(canonical)).toBe(literal);
    expect(findUnsupportedMarkdownFormats(literal)).toEqual([]);
    expect(literalizeUnsupportedMarkdown(literal)).toBe(literal);
  });

  it('逐行降级嵌套任务项与同段内的每个显式硬换行', () => {
    const task = '- 普通项目\n  - [ ] 嵌套任务';
    const taskLiteral = literalizeUnsupportedMarkdown(task);
    expect(findUnsupportedMarkdownFormats(task)[0]?.type).toBe('task-list');
    expect(taskLiteral).toContain('\n\n  \\- \\[ \\] 嵌套任务');
    expect(findUnsupportedMarkdownFormats(taskLiteral)).toEqual([]);

    const hardBreaks = '第一行  \n第二行\\\n第三行';
    const literal = literalizeUnsupportedMarkdown(hardBreaks);
    expect(findUnsupportedMarkdownFormats(hardBreaks)).toEqual([
      { type: 'hard-break', startLine: 0, endLine: 0 },
      { type: 'hard-break', startLine: 1, endLine: 1 },
    ]);
    expect(findUnsupportedMarkdownFormats(literal)).toEqual([]);
  });
});
