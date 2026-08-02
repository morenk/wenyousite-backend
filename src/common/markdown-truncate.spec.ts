/** Markdown 摘要清理测试：图片统一降级为占位，不泄漏 Milkdown 比例 alt */

import { truncateMarkdown } from './markdown-truncate';

describe('truncateMarkdown', () => {
  it('短 Markdown 也应清理语法', () => {
    expect(truncateMarkdown('**加粗正文**')).toBe('加粗正文');
  });

  it('纯图片应显示统一占位且不泄漏 Milkdown 的 1.00 比例 alt', () => {
    expect(truncateMarkdown('![1.00](https://cdn.example.com/a.jpg)')).toBe('[图片]');
  });

  it('图文混排在原位置保留图片占位', () => {
    expect(truncateMarkdown('开头 ![1.00](https://cdn.example.com/a.jpg) 后续内容'))
      .toBe('开头 [图片] 后续内容');
  });

  it('图片正常 alt 也统一显示为图片占位', () => {
    expect(truncateMarkdown('![风景照片](https://cdn.example.com/a.jpg)')).toBe('[图片]');
  });
});
