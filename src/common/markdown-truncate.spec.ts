/** Markdown 摘要清理测试：通知预览不泄漏图片及 Milkdown 比例 alt */

import { truncateMarkdown } from './markdown-truncate';

describe('truncateMarkdown', () => {
  it('短 Markdown 也应清理语法', () => {
    expect(truncateMarkdown('**加粗正文**')).toBe('加粗正文');
  });

  it('纯图片不应显示 Milkdown 的 1.00 比例 alt', () => {
    expect(truncateMarkdown('![1.00](https://cdn.example.com/a.jpg)')).toBe('');
  });

  it('图文混排只保留文字', () => {
    expect(truncateMarkdown('开头 ![1.00](https://cdn.example.com/a.jpg) 后续内容'))
      .toBe('开头  后续内容');
  });
});
