import { analyzeMarkdownBlockBoundaries } from './markdown-block-boundaries';
import MarkdownIt from 'markdown-it';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertTextColorWrite,
  normalizeTextColors,
  parseTextColors,
  maskTextColorTags,
  projectTextColors,
  isTextColorResponseRoute,
  stripTextColors,
} from './text-colors';
import { prepareMarkdownContent } from './markdown-content';
import { truncateMarkdown } from './markdown-truncate';
import { BusinessException } from './exceptions/business.exception';
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/markdown-text-color-v1-fixtures.json'), 'utf8'),
) as {
  validCases: Array<{ id: string; source: string; canonical: string; fallback: string }>;
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
const color = (text: string) => `<span data-wenyou-color-v1="#D14343">${text}</span>`;
describe('文本颜色 v1 契约', () => {
  it.each(fixture.validCases)('$id 保源规范化及安全降级', (row) => {
    expect(normalizeTextColors(row.source)).toBe(row.canonical);
    expect(prepareMarkdownContent(row.source, { textColorVersion: 1 })).toBe(row.canonical);
    expect(stripTextColors(row.source)).toBe(row.fallback);
  });
  it.each(fixture.invalidSources)('拒绝非法标记 %s', (source) => {
    expect(() => prepareMarkdownContent(source, { textColorVersion: 1 })).toThrow();
  });
  it.each(fixture.writeCases)('$id 写入协商', (row) => {
    const action = () => assertTextColorWrite(row.content, row.previous, row.version, row.enabled);
    if (row.expectedCode === null) expect(action).not.toThrow();
    else {
      try {
        action();
        throw new Error('应拒绝');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).errorCode).toBe(row.expectedCode);
      }
    }
  });
  it.each(['# 标题', '> 引用', '- 列表', '1. 序号', '***', '[引用]: /target'])(
    '去色不激活字面块标记 %s',
    (text) => {
      const fallback = stripTextColors(color(text));
      expect(fallback).not.toBe(text);
      expect(truncateMarkdown(fallback, 500)).toBe(text);
    },
  );
  it('代码和转义不是能力；内层样式与颜色边界必须平衡', () => {
    expect(parseTextColors('``' + color('文字') + '``')).toEqual([]);
    expect(() =>
      prepareMarkdownContent(color('`[[dice:v1:x:1d6]]`'), { textColorVersion: 1 }),
    ).not.toThrow();
    expect(parseTextColors('```\n' + color('文字') + '\n```')).toEqual([]);
    expect(() => normalizeTextColors('**' + color('文字') + '**')).toThrow();
    expect(() => normalizeTextColors(color('**文字') + '**')).toThrow();
  });
  it('关闭新写不能借重复已有范围新增颜色', () => {
    expect(() => assertTextColorWrite(color('甲') + color('甲'), color('甲'), 1, false)).toThrow();
    expect(() =>
      assertTextColorWrite(
        color('乙') + '\n' + color('甲'),
        color('甲') + '\n' + color('乙'),
        1,
        false,
      ),
    ).not.toThrow();
  });
  it('所有正文/保源字段及草稿嵌套响应使用去色副本，标题保持', () => {
    const projected = {
      title: color('标题'),
      content: color('正文'),
      drafts: [{ sourceContent: color('草稿') }],
    };
    projectTextColors(projected);
    expect(projected).toEqual({
      title: color('标题'),
      content: '正文',
      drafts: [{ sourceContent: '草稿' }],
    });
    const capable = { content: color('正文') };
    projectTextColors(capable, 1);
    expect(capable.content).toBe(color('正文'));
    expect(truncateMarkdown(color('**正文**'), 100)).toBe('正文');
  });
});

const semantics = (source: string) => {
  const parser = new MarkdownIt({ html: true });
  const marks: string[] = [],
    result: Array<[string, string]> = [];
  for (const block of parser.parse(source, {})) {
    if (block.type !== 'inline') continue;
    for (const token of block.children ?? []) {
      if (token.type === 'html_inline') continue;
      if (token.nesting === 1) marks.push(token.type);
      if (token.nesting === -1) marks.pop();
      if (token.type === 'text' || token.type === 'code_inline') {
        for (const character of token.content)
          result.push([
            character,
            [...marks, ...(token.type === 'code_inline' ? ['code'] : [])].sort().join(','),
          ]);
      }
    }
  }
  return result;
};
describe('去色邻接与路由边界', () => {
  const formats = ['*x*', '**x**', '~~x~~', '***x***', '`x`', '普通字'];
  it.each(formats.flatMap((left) => formats.map((right) => [left, right])))(
    '保留左右格式 %s / %s',
    (left, right) => {
      for (const source of [color(left) + right, left + color(right)])
        expect(semantics(stripTextColors(source))).toEqual(semantics(source));
    },
  );
  it.each([
    '/api/v1/moments',
    '/api/v1/search/moments',
    '/api/v1/moments/:id/comments',
    '/api/v1/direct-messages/:id',
    '/api/v1/admin/moderation/cases',
  ])('纯文本/审计路径不降级 %s', (route) => {
    const value = { content: color('字面示例') };
    if (isTextColorResponseRoute(route)) projectTextColors(value);
    expect(value.content).toBe(color('字面示例'));
  });
  it.each([
    '/api/v1/posts/:id',
    '/threads/:id',
    '/drafts/state',
    '/search/posts',
    '/users/:id/posts',
    '/users/:id/recent-replies',
  ])('正文路由支持降级 %s', (route) => expect(isTextColorResponseRoute(route)).toBe(true));
});

describe('颜色不可放宽 HTML/CSS 白名单', () => {
  it.each([
    '<b>HTML</b> ',
    '<script>alert(1)</script> ',
    '<span style="color:red">任意HTML</span> ',
  ])('拒绝范围外的 %s', (outside) => {
    expect(() =>
      prepareMarkdownContent(outside + color('允许颜色'), { textColorVersion: 1 }),
    ).toThrow();
  });
});

describe('去色保留邻接原子', () => {
  it.each([
    '[[dice:v1:550e8400-e29b-41d4-a716-446655440000:1d6]]',
    '@全体玩家',
    '/threads/c111111111111111111111111',
    '[@同名](/users/c111111111111111111111111)',
  ])('原子源码不被转义 %s', (atom) => {
    expect(stripTextColors(color('有色') + ' ' + atom)).toContain(atom);
    expect(stripTextColors(atom + ' ' + color('有色'))).toContain(atom);
  });
});

it('去色保留同段表情标题协议', () => {
  const image =
    '![表情](https://example.com/a.webp "wenyousite-sticker:v1:c111111111111111111111111")';
  expect(stripTextColors(color('有色') + ' ' + image)).toContain(
    '"wenyousite-sticker:v1:c111111111111111111111111"',
  );
});

it.each(['**a**', '***a***'])('三段attention边界 %s', (left) => {
  const source = left + color('*斜体*') + '***a***';
  expect(semantics(stripTextColors(source))).toEqual(semantics(source));
});

describe('旧端去色保留对齐协议块边界', () => {
  it.each(
    ['center', 'right'].flatMap((alignment) =>
      ['', '## ', '### '].map((prefix) => [alignment, prefix]),
    ),
  )('%s 对齐 %s 保留紧接前段的协议行与 32 种内联格式', (alignment, prefix) => {
    for (let marks = 0; marks < 32; marks++) {
      let content = '如何呢👩‍💻e\u0301';
      if (marks & 16) content = '`' + content + '`';
      if (marks & 4) content = '~~' + content + '~~';
      if (marks & 2) content = '*' + content + '*';
      if (marks & 1) content = '**' + content + '**';
      if (marks & 8) content = '[' + content + '](https://example.com/path "链接标题")';
      const source = `前段\n[wenyousite-align-v1-${alignment}]: #\n${prefix}${color(content)}\n\n后段`;
      const fallback = stripTextColors(source);
      expect(prepareMarkdownContent(source, { textColorVersion: 1 })).toBe(source);
      expect(fallback).toContain(`[wenyousite-align-v1-${alignment}]: #\n${prefix}`);
      expect(prepareMarkdownContent(fallback)).toBe(fallback);
      expect(truncateMarkdown(source, 500)).not.toContain('wenyousite-align');
      expect(semantics(fallback)).toEqual(semantics(source));
      const before = analyzeMarkdownBlockBoundaries(maskTextColorTags(source));
      const after = analyzeMarkdownBlockBoundaries(fallback);
      expect(before.invalidMarkerLines).toEqual([]);
      expect(after.invalidMarkerLines).toEqual([]);
      expect(after.boundaries).toEqual(before.boundaries);
    }
  });
  it('连续对齐段落不需要空行且各自保留颜色外的格式', () => {
    const source = `前段\n[wenyousite-align-v1-center]: #\n${color('**居中**')}\n[wenyousite-align-v1-right]: #\n${color('*靠右*')}`;
    expect(stripTextColors(source)).toBe(
      '前段\n[wenyousite-align-v1-center]: #\n**居中**\n[wenyousite-align-v1-right]: #\n*靠右*',
    );
  });
});

describe('颜色遵循空段与排版块边界', () => {
  it('空段紧邻彩色标题不被视为整块 HTML，旧端保留空段与标题', () => {
    const source = '<br />\n## ' + color('杀！');
    expect(source.length).toBe(56);
    expect(prepareMarkdownContent(source, { textColorVersion: 1 })).toBe(source);
    expect(parseTextColors(source, true)).toHaveLength(1);
    expect(stripTextColors(source)).toBe('<br />\n## 杀！');
  });
  it.each([
    '<br />\n',
    '<br>\n',
    '<BR />\n',
    '   <br />\n',
    '<br />\n<br />\n',
    '> <br />\n> ',
    '- ',
    '1. ',
    '> ',
    '<br />\n- ',
    '<br />\n1. ',
    '<br />\n> ',
    '<br />\n[wenyousite-align-v1-center]: #\n',
    '<br />\n[wenyousite-align-v1-right]: #\n',
  ])('有效块前缀 %s 保源和降级', (prefix) => {
    for (const marks of [
      '正文',
      '**粗体**',
      '*斜体*',
      '~~删除~~',
      '`代码`',
      '[链接](https://example.com)',
      '中文👩‍💻e\u0301',
    ]) {
      const source = prefix + color(marks);
      const normalized = prepareMarkdownContent(source, { textColorVersion: 1 });
      expect(parseTextColors(normalized, true)).toHaveLength(1);
      expect(parseTextColors(normalized, true)[0].content).toBe(marks);
      const fallback = stripTextColors(normalized);
      expect(fallback).not.toContain('data-wenyou-color');
      expect(prepareMarkdownContent(fallback)).toBe(fallback);
      expect(analyzeMarkdownBlockBoundaries(fallback).tokens.map((t) => [t.type, t.map])).toEqual(
        analyzeMarkdownBlockBoundaries(maskTextColorTags(normalized)).tokens.map((t) => [
          t.type,
          t.map,
        ]),
      );
    }
  });
  it.each([
    '<br />\n<div>' + color('隐藏') + '</div>',
    '<br onclick="x">\n' + color('隐藏'),
    '<br />\n<span style="color:red">' + color('隐藏') + '</span>',
    '<br />\n<span data-wenyou-color-v1="#D14343">跨\n段</span>',
    '<br />\n' + color('![图片](https://example.com/a.png)'),
    '<br />\n' + color('[[dice:v1:550e8400-e29b-41d4-a716-446655440000:1d6]]'),
  ])('空段后依然拒绝非法内容 %s', (source) => {
    expect(() => prepareMarkdownContent(source, { textColorVersion: 1 })).toThrow();
  });
  it.each([
    '```\n<br />\n' + color('代码') + '\n```',
    '    <br />\n    ' + color('代码'),
    '\\' + color('字面'),
  ])('代码与转义中的标签不产生颜色 %s', (source) => {
    expect(parseTextColors(source, true)).toEqual([]);
  });
  it('连续彩色 H3/H2 保持两个范围', () => {
    const source = '### ' + color('杀！') + '\n## ' + color('杀！');
    expect(prepareMarkdownContent(source, { textColorVersion: 1 })).toBe(source);
    expect(parseTextColors(source, true)).toHaveLength(2);
    expect(stripTextColors(source)).toBe('### 杀！\n## 杀！');
  });
});

describe('完整块上下文和源码偏移保持', () => {
  it.each(['[目标]: https://example.com\n\n', '\n\n[目标]: https://example.com'])(
    '引用链接外层仍拒绝着色范围嵌套 %s',
    (definition) => {
      const source = definition.startsWith('\n')
        ? '[' + color('正文') + '][目标]' + definition
        : definition + '[' + color('正文') + '][目标]';
      expect(() => normalizeTextColors(source)).toThrow();
    },
  );
  it.each(['**', '*', '~~'])('外层格式 %s 不得包裹颜色', (mark) => {
    expect(() => normalizeTextColors(mark + color('正文') + mark)).toThrow();
  });
  it.each(['', '## ', '### ', '- ', '1. ', '  - ', '> '])(
    '重复内联内容和 %s 前缀的范围偏移',
    (prefix) => {
      const source = prefix + color('同文') + ' ' + color('同文') + '\n\n' + prefix + color('同文');
      const ranges = parseTextColors(source, true);
      expect(ranges).toHaveLength(3);
      for (const range of ranges) {
        expect(source.slice(range.start, range.end)).toBe(color('同文'));
        expect(source.slice(range.contentStart, range.contentEnd)).toBe('同文');
      }
      expect(normalizeTextColors(source)).toBe(source);
    },
  );
  it('多行同文按原始行号定位', () => {
    const source = color('同文') + '\n' + color('同文');
    const ranges = parseTextColors(source, true);
    expect(ranges.map((range) => range.start)).toEqual([0, color('同文').length + 1]);
  });
});

it.each([
  'https://example.com ' + color('正文'),
  color('正文') + ' https://example.com',
  color('https://example.com'),
  color('[普通链接](https://example.com)'),
])('普通链接与颜色组合仍可保存 %s', (source) => {
  expect(prepareMarkdownContent(source, { textColorVersion: 1 })).toBe(source);
  expect(parseTextColors(source, true)).toHaveLength(1);
});
it.each([
  color('[@提及](/users/c111111111111111111111111)'),
  color('/threads/c111111111111111111111111'),
  color('[音频](https://example.com/a.mp3 "wenyousite-audio:v1:x")'),
])('身份与媒体原子仍拒绝着色 %s', (source) => {
  expect(() => normalizeTextColors(source)).toThrow();
});
