/** Markdown v4 契约测试：以后端纯函数执行跨语言黄金语料。 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorCode } from './exceptions/error-codes';
import {
  assertSupportedMarkdown,
  findUnsupportedMarkdownFormats,
  hasVisibleMarkdownContent,
  literalizeUnsupportedMarkdown,
  normalizeMarkdownContent,
  prepareMarkdownContent,
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

interface ImageAlignmentFixtureCase {
  id: string;
  markdown: string;
  supported: boolean;
  expectedAlignment: 'left' | 'center' | 'right' | null;
}

interface ImageAlignmentFixtureFile {
  contract: string;
  version: number;
  markdownContractVersion: number;
  defaultAlignment: string;
  rules: Record<string, string>;
  cases: ImageAlignmentFixtureCase[];
}

const fixturePath = resolve(__dirname, '../../contracts/markdown-v4-fixtures.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as MarkdownFixtureFile;
const imageAlignmentFixtures = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/markdown-v5-image-alignment-fixtures.json'), 'utf8'),
) as ImageAlignmentFixtureFile;

describe('Markdown v4 黄金语料', () => {
  it('协议标识、版本和 case id 合法', () => {
    expect(fixtures.contract).toBe('wenyousite-markdown');
    expect(fixtures.version).toBe(4);
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

describe('Markdown v5 图片块对齐扩展', () => {
  const v4 = { markdownContractVersion: 4 };
  const v5 = { markdownContractVersion: imageAlignmentFixtures.markdownContractVersion };

  it('图片对齐扩展 fixture 保持版本与 case id 合法', () => {
    expect(imageAlignmentFixtures.contract).toBe('wenyousite-markdown-image-alignment');
    expect(imageAlignmentFixtures.version).toBe(1);
    expect(imageAlignmentFixtures.defaultAlignment).toBe('left');
    expect(new Set(imageAlignmentFixtures.cases.map((item) => item.id)).size)
      .toBe(imageAlignmentFixtures.cases.length);
  });

  it.each(imageAlignmentFixtures.cases)('$id 遵守图片块对齐白名单', ({ markdown, supported }) => {
    const issues = findUnsupportedMarkdownFormats(markdown, v5);
    expect(issues[0]?.type ?? null).toBe(supported ? null : 'invalid-alignment');
    if (supported) {
      expect(() => assertSupportedMarkdown(markdown, v5)).not.toThrow();
    }
  });

  it('只允许独占一行的普通图片使用居中或居右标记', () => {
    const centered = '[wenyousite-align-v1-center]: #\n![图片](https://cdn.example.com/a.png)';
    const mixed = '[wenyousite-align-v1-center]: #\n文字 ![图片](https://cdn.example.com/a.png)';
    const sticker = '[wenyousite-align-v1-center]: #\n![表情](https://cdn.example.com/a.webp "wenyousite-sticker:v1:asset")';

    expect(findUnsupportedMarkdownFormats(centered, v4)[0]?.type).toBe('invalid-alignment');
    expect(findUnsupportedMarkdownFormats(centered, v5)).toEqual([]);
    expect(() => assertSupportedMarkdown(centered, v5)).not.toThrow();
    expect(findUnsupportedMarkdownFormats(mixed, v5)[0]?.type).toBe('invalid-alignment');
    expect(findUnsupportedMarkdownFormats(sticker, v5)).toEqual([]);
  });

  it('左对齐仍使用无标记的默认状态', () => {
    const source = '![图片](https://cdn.example.com/a.png)';
    expect(prepareMarkdownContent(source, v5)).toBe(source);
  });
});
