import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareMarkdownContent } from './markdown-content';
import { assertTextFontWrite, projectTextColors, projectTextFonts } from './text-colors';
import { BusinessException } from './exceptions/business.exception';
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/markdown-text-font-v2-fixtures.json'), 'utf8'),
) as {
  validCases: Array<{ id: string; source: string; canonical: string; v1: string; legacy: string }>;
  invalidSources: string[];
  writeCases: Array<{
    id: string;
    content: string;
    previous: string;
    version: number;
    allowed: string[];
    expectedCode: number | null;
  }>;
};
describe('动态字体 v2 及混合正文', () => {
  it.each(fixtures.validCases)('$id 保源与两级旧端投影', (row) => {
    expect(prepareMarkdownContent(row.source, { textFontVersion: 2, textColorVersion: 1 })).toBe(
      row.canonical,
    );
    const current = { content: row.canonical };
    projectTextFonts(current, 2);
    expect(current.content).toBe(row.canonical);
    const v1 = { content: row.canonical };
    projectTextFonts(v1, 1);
    expect(v1.content).toBe(row.v1);
    const legacy = { sourceContent: row.canonical };
    projectTextFonts(legacy);
    projectTextColors(legacy);
    expect(legacy.sourceContent).toBe(row.legacy);
  });
  it.each(fixtures.invalidSources)('拒绝错误语法 %s', (source) => {
    expect(() =>
      prepareMarkdownContent(source, { textFontVersion: 2, textColorVersion: 1 }),
    ).toThrow();
  });
  it.each(fixtures.writeCases)('$id 写保护', (row) => {
    const call = () =>
      assertTextFontWrite(row.content, row.previous, row.version, false, new Set(row.allowed));
    if (row.expectedCode === null) expect(call).not.toThrow();
    else {
      try {
        call();
        throw new Error('应拒绝');
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(row.expectedCode);
      }
    }
  });
});
