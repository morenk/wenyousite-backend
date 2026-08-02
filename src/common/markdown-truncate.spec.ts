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

  it('回复只有 < 与 > 分行时预览保留字面内容，不被当 HTML 标签吞掉', () => {
    expect(truncateMarkdown('<\n\n\n\\>')).toBe('<\n\n\n>');
  });

  it('Milkdown 转义的 HTML 标签保留字面文本，不残留反斜杠', () => {
    expect(truncateMarkdown('\\<div>代码\\</div>')).toBe('<div>代码</div>');
    expect(truncateMarkdown('使用 \\<br> 换行')).toBe('使用 <br> 换行');
  });

  it('真实引用块仍被清理，保留引用内容', () => {
    expect(truncateMarkdown('> 引用内容')).toBe('引用内容');
  });

  it('普通反斜杠路径不受影响', () => {
    expect(truncateMarkdown('保存到 C:\\temp 目录')).toBe('保存到 C:\\temp 目录');
  });
});
