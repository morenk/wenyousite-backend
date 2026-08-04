/** Markdown 内容规则测试：纯空白/分隔线不可发布，图片和有效正文可发布 */

import { hasVisibleMarkdownContent } from './markdown-content';

describe('hasVisibleMarkdownContent', () => {
  it('rejects blank lines and Milkdown empty paragraph markers', () => {
    expect(hasVisibleMarkdownContent('\n\n<br />\n<br/>\n')).toBe(false);
  });

  it('rejects a thematic break by itself', () => {
    expect(hasVisibleMarkdownContent('---')).toBe(false);
  });

  it('accepts an image by itself', () => {
    expect(hasVisibleMarkdownContent('![图](https://example.com/a.png)')).toBe(true);
  });

  it('accepts code and text with surrounding blank lines', () => {
    expect(hasVisibleMarkdownContent('\n\n```\n代码\n```\n')).toBe(true);
    expect(hasVisibleMarkdownContent('\n\n**正文**\n<br />')).toBe(true);
  });

  it('accepts pure numeric正文，不把数字误判为有序列表前缀', () => {
    expect(hasVisibleMarkdownContent('123')).toBe(true);
    expect(hasVisibleMarkdownContent('1.00')).toBe(true);
  });

  it('仍然过滤只有列表标记的正文', () => {
    expect(hasVisibleMarkdownContent('1.')).toBe(false);
    expect(hasVisibleMarkdownContent('1)')).toBe(false);
  });

  it('rejects empty links and formatting-only text', () => {
    expect(hasVisibleMarkdownContent('[ ]()\n***')).toBe(false);
  });
});
