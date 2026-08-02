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

  it('Milkdown 转义的字面 > 保留为字符，不残留反斜杠也不变空', () => {
    expect(truncateMarkdown('\\> 牛逼啊')).toBe('> 牛逼啊');
    expect(truncateMarkdown('\\>')).toBe('>');
    expect(truncateMarkdown('\\>niubi')).toBe('>niubi');
  });

  it('Milkdown 转义的行首引用块保留字面 >，不残留反斜杠', () => {
    expect(truncateMarkdown('\\> <\n\n\n>')).toBe('>');
  });

  it('Milkdown 转义的 HTML 标签 < > 还原后清理，不残留反斜杠', () => {
    expect(truncateMarkdown('\\<div>代码\\</div>')).toBe('代码');
  });

  it('普通反斜杠路径不受影响', () => {
    expect(truncateMarkdown('保存到 C:\\temp 目录')).toBe('保存到 C:\\temp 目录');
  });
});
