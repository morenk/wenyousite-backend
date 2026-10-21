import * as fontCatalog from './text-font-catalog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertTextFontWrite,
  parseTextFonts,
  parseTextStyles,
  projectTextFonts,
  projectTextColors,
  stripTextStyles,
  stripTextFonts,
  stripTextColors,
} from './text-colors';
import { prepareMarkdownContent } from './markdown-content';
import { truncateMarkdown, truncateMarkdownToCompactPlainText } from './markdown-truncate';
import { BusinessException } from './exceptions/business.exception';
import { TEXT_FONT_IDS, isTextFontSourceReady } from './text-font-catalog';
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/markdown-text-font-v1-fixtures.json'), 'utf8'),
) as {
  validCases: Array<{
    id: string;
    source: string;
    canonical: string;
    fontOnly: string;
    colorOnly: string;
    legacy: string;
  }>;
  invalidSources: string[];
  writeCases: Array<{
    id: string;
    content: string;
    previous: string;
    version?: number;
    enabled: boolean;
    expectedCode: number | null;
  }>;
};
const font = (text: string, id = 'wenkai') => `<span data-wenyou-font-v1="${id}">${text}</span>`;
describe('文本字体 v1 共享契约', () => {
  it.each(fixture.validCases)('$id 四种能力组合', (row) => {
    expect(prepareMarkdownContent(row.source, { textFontVersion: 1, textColorVersion: 1 })).toBe(
      row.canonical,
    );
    expect(stripTextFonts(row.source)).toBe(row.colorOnly);
    expect(stripTextColors(row.source)).toBe(row.fontOnly);
    expect(stripTextStyles(row.source)).toBe(row.legacy);
    expect(stripTextStyles(row.legacy)).toBe(row.legacy);
    for (const [fontVersion, colorVersion, expected] of [
      [1, 1, row.canonical],
      [1, undefined, row.fontOnly],
      [undefined, 1, row.colorOnly],
      [undefined, undefined, row.legacy],
    ] as const) {
      const value = { content: row.canonical, child: [{ sourceContent: row.canonical }] };
      projectTextFonts(value, fontVersion);
      projectTextColors(value, colorVersion);
      expect(value.content).toBe(expected);
      expect(value.child[0].sourceContent).toBe(expected);
    }
  });
  it.each(fixture.invalidSources)('拒绝非法标记 %s', (source) => {
    expect(() =>
      prepareMarkdownContent(source, { textFontVersion: 1, textColorVersion: 1 }),
    ).toThrow(BusinessException);
  });
  it.each(fixture.writeCases)('$id 写保护', (row) => {
    if (row.expectedCode === null)
      expect(() =>
        assertTextFontWrite(row.content, row.previous, row.version, row.enabled),
      ).not.toThrow();
    else {
      try {
        assertTextFontWrite(row.content, row.previous, row.version, row.enabled);
        throw new Error('应拒绝');
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(row.expectedCode);
      }
    }
  });
  it('每个白名单字体可与粗斜体组合，未知字体阅读保留文字', () => {
    expect(new Set(TEXT_FONT_IDS).size).toBe(29);
    for (const id of TEXT_FONT_IDS.filter(isTextFontSourceReady))
      expect(prepareMarkdownContent(font('***中英 Hello***', id), { textFontVersion: 1 })).toBe(
        font('***中英 Hello***', id),
      );
    expect(stripTextStyles(font('**文字**', 'future-family'))).toBe('**文字**');
    expect(() => assertTextFontWrite('文字', font('文字', 'future-family'))).toThrow();
  });
  it('未取得原字库的登记项拒绝新写，已存范围可保留和移除', () => {
    const readiness = jest.spyOn(fontCatalog, 'isTextFontSourceReady').mockReturnValue(false);
    try {
      expect(() => assertTextFontWrite(font('文字'), '', 1, true)).toThrow();
      expect(() => assertTextFontWrite(font('文字'), font('文字'), 1, true)).not.toThrow();
      expect(() => assertTextFontWrite('文字', font('文字'), 1, true)).not.toThrow();
    } finally {
      readiness.mockRestore();
    }
  });
  it('小城退役后保留历史解析与覆盖保护，拒绝新增或扩展范围', () => {
    const saved = font('历史文字', 'xiaocheng-lafeng');
    expect(TEXT_FONT_IDS).toContain('xiaocheng-lafeng');
    expect(isTextFontSourceReady('xiaocheng-lafeng')).toBe(false);
    expect(prepareMarkdownContent(saved, { textFontVersion: 1 })).toBe(saved);
    expect(stripTextStyles(saved)).toBe('历史文字');
    expect(() => assertTextFontWrite(saved, '', 1, true)).toThrow(BusinessException);
    expect(() => assertTextFontWrite(saved, saved, 1, true)).not.toThrow();
    expect(() => assertTextFontWrite('历史文字', saved, 1, true)).not.toThrow();
    expect(() => assertTextFontWrite(font('历史文字新增', 'xiaocheng-lafeng'), saved, 1, true)).toThrow(BusinessException);
    expect(() => assertTextFontWrite('历史文字', saved)).toThrow(BusinessException);
  });
  it('移除未发布的小薇候选后拒绝新写，阅读仍保留文字', () => {
    expect(TEXT_FONT_IDS).not.toContain('zcoolxiaowei');
    expect(() =>
      prepareMarkdownContent(font('保留文字', 'zcoolxiaowei'), { textFontVersion: 1 }),
    ).toThrow(BusinessException);
    expect(stripTextStyles(font('**保留文字**', 'zcoolxiaowei'))).toBe('**保留文字**');
  });
  it('只识别真实标签，不激活代码、转义、URL/title中的同形源码', () => {
    for (const source of [
      '`' + font('文字') + '`',
      '\\' + font('文字'),
      '[链接](https://example.com "' + font('文字').replaceAll('"', '&quot;') + '")',
    ])
      expect(parseTextFonts(source)).toEqual([]);
  });
  it('段落、标题、列表、引用与对齐保持边界', () => {
    for (const prefix of [
      '',
      '## ',
      '- ',
      '> ',
      '<br />\n## ',
      '[wenyousite-align-v1-center]: #\n',
    ]) {
      const source = prefix + font('**文字**');
      expect(prepareMarkdownContent(source, { textFontVersion: 1 })).toBe(source);
      expect(stripTextStyles(source)).toBe(prefix + '**文字**');
      expect(truncateMarkdown(source, 100)).toContain('文字');
    }
  });
  it('去除字体边界不合并或激活相邻Markdown分隔符', () => {
    const source = font('**粗体**') + font('*斜体*') + font('***粗斜体***');
    expect(truncateMarkdownToCompactPlainText(stripTextStyles(source), 100)).toBe('粗体斜体粗斜体');
    expect(parseTextStyles(stripTextStyles(source))).toEqual([]);
  });
  it('字体关闭时不能复制已有范围增加下载标记', () => {
    const source = font('文字');
    expect(() => assertTextFontWrite(source + source, source, 1, false)).toThrow();
    expect(() => assertTextFontWrite(font('文字', 'source-han-sans'), source, 1, false)).toThrow();
  });
});
