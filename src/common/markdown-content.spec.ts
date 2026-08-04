/** Markdown v1 契约测试：以后端纯函数执行跨语言黄金语料 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasVisibleMarkdownContent, normalizeMarkdownContent } from './markdown-content';

interface MarkdownFixtureCase {
  id: string;
  description: string;
  input: string;
  canonical: string;
  visible: boolean;
}

interface MarkdownFixtureFile {
  contract: string;
  version: number;
  cases: MarkdownFixtureCase[];
}

const fixturePath = resolve(__dirname, '../../contracts/markdown-v1-fixtures.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as MarkdownFixtureFile;

describe('Markdown v1 黄金语料', () => {
  it('协议标识、版本和 case id 合法', () => {
    expect(fixtures.contract).toBe('wenyousite-markdown');
    expect(fixtures.version).toBe(1);
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
});
