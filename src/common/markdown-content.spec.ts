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

  it('rejects empty links and formatting-only text', () => {
    expect(hasVisibleMarkdownContent('[ ]()\n***')).toBe(false);
  });
});
