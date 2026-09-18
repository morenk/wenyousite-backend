import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { truncateMarkdown, truncateMarkdownToCompactPlainText } from './markdown-truncate';

describe('行内代码组合的摘要字面语义', () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../contracts/markdown-inline-combinations-v1-fixtures.json'),
      'utf8',
    ),
  ) as {
    cases: Array<{
      id: string;
      kind: string;
      canonical?: string;
      segments: Array<{ text: string }>;
    }>;
  };
  it.each(fixture.cases.filter((item) => item.kind === 'canonical'))(
    '$id 保留字面内容且没有多余定界符',
    (item) => {
      const expected = item.segments.map((segment) => segment.text).join('');
      expect(truncateMarkdown(item.canonical!)).toBe(expected);
      expect(truncateMarkdownToCompactPlainText(item.canonical!)).toBe(
        expected.replace(/\s+/gu, ' ').trim(),
      );
    },
  );
  it.each([
    ['*`a*b`*', 'a*b'],
    ['**`a_b~~c`**', 'a_b~~c'],
    ['[`![x](https://example.com/x)`](https://example.com)', '![x](https://example.com/x)'],
    ['*`\\* &amp; &#42;`*', '\\* &amp; &#42;'],
    ['甲*`   `*乙', '甲   乙'],
    ['> *`a*\n> b`*', 'a* b'],
    ['- **`a*`**', 'a*'],
    ['*```a``b```*', 'a``b'],
    ['WENYOUCODEPLACEHOLDER *`a*b`*', 'WENYOUCODEPLACEHOLDER a*b'],
  ])('%s 保留真实代码内容', (markdown, expected) => {
    expect(truncateMarkdown(markdown)).toBe(expected);
  });
  it('有封面时也保留代码里的图片源码与站内 URL', () => {
    const markdown =
      '*`![x](https://example.com/x) https://wenyou.site/threads/cmsewdo0h000x7qv6aa77ll1v`*';
    expect(truncateMarkdownToCompactPlainText(markdown, 1000, 0, { omitImages: true })).toBe(
      '![x](https://example.com/x) https://wenyou.site/threads/cmsewdo0h000x7qv6aa77ll1v',
    );
  });
  it('普通实体单遍解码，代码实体保持字面文本', () => {
    expect(truncateMarkdownToCompactPlainText('&amp;lt; *`&amp;lt;`*')).toBe('&lt; &amp;lt;');
    expect(truncateMarkdownToCompactPlainText('\\`a\\*b\\`')).toBe('`a*b`');
  });
  it('实体或格式拼接不能伪造代码占位符', () => {
    expect(truncateMarkdownToCompactPlainText('&#87;ENYOUCODEPLACEHOLDER0END *`a*b`*')).toBe(
      'WENYOUCODEPLACEHOLDER0END a*b',
    );
    expect(truncateMarkdownToCompactPlainText('WENYOU**CODE**PLACEHOLDER0END *`a*b`*')).toBe(
      'WENYOUCODEPLACEHOLDER0END a*b',
    );
    expect(truncateMarkdownToCompactPlainText('&#xE100;0END *`a*b`*')).toBe('\ue1000END a*b');
    expect(truncateMarkdownToCompactPlainText('\ue1000END *`a*b`*')).toBe('\ue1000END a*b');
    expect(truncateMarkdown('&#xE100;0END *`a*b`*')).toBe('&#xE100;0END a*b');
  });
  it('大量独立代码区间保持顺序和边界，代码内容不被二次解释', () => {
    for (const count of [100, 500, 1000]) {
      const markdown = Array.from({ length: count }, (_, index) => `*\`a${index}*b\`*`).join(' ');
      const expected = Array.from({ length: count }, (_, index) => `a${index}*b`).join(' ');
      expect(truncateMarkdown(markdown, 20000, 0)).toBe(expected);
    }
  });
});
