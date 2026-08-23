/** Markdown 摘要清理测试：图片统一降级为占位，不泄漏 Milkdown 比例 alt */

import {
  truncateMarkdown,
  truncateMarkdownToCompactPlainText,
} from './markdown-truncate';

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

  it('Milkdown 转义的其他特殊字符还原为字面，不残留反斜杠', () => {
    expect(truncateMarkdown('a\\*b\\*c')).toBe('a*b*c');
    expect(truncateMarkdown('a\\_b\\_c')).toBe('a_b_c');
    expect(truncateMarkdown('a\\~b\\~c')).toBe('a~b~c');
    expect(truncateMarkdown('a\\|b')).toBe('a|b');
    expect(truncateMarkdown('a\\=b')).toBe('a=b');
    expect(truncateMarkdown('\\[x\\]')).toBe('[x]');
    expect(truncateMarkdown('\\{x\\}')).toBe('{x}');
    expect(truncateMarkdown('\\`code\\`')).toBe('`code`');
    expect(truncateMarkdown('\\# 标题')).toBe('# 标题');
    expect(truncateMarkdown('\\- 条目')).toBe('- 条目');
  });

  it('真实 Markdown 强调/斜体/标题/链接/代码/列表仍被清理', () => {
    expect(truncateMarkdown('**加粗**')).toBe('加粗');
    expect(truncateMarkdown('*斜体*')).toBe('斜体');
    expect(truncateMarkdown('# 标题')).toBe('标题');
    expect(truncateMarkdown('[链接](https://example.com)')).toBe('链接');
    expect(truncateMarkdown('`code`')).toBe('code');
    expect(truncateMarkdown('- 列表项')).toBe('列表项');
    expect(truncateMarkdown('1. 有序')).toBe('有序');
  });

  it('站内传送门摘要保留自定义名称，裸链接使用默认名称', () => {
    const threadId = 'cmsewdo0h000x7qv6aa77ll1v';
    expect(truncateMarkdown(`[设定 A](/threads/${threadId})`)).toBe('设定 A');
    expect(truncateMarkdown(`入口 https://wenyou.site/threads/${threadId}`)).toBe('入口 传送门');
  });

  it('Milkdown 硬换行（行尾反斜杠）还原为换行，不残留反斜杠', () => {
    expect(truncateMarkdown('<看看呢>\\\n\\>看看呢<\n\n<\n\n\\>'))
      .toBe('<看看呢>\n>看看呢<\n\n<\n\n>');
  });

  it('普通反斜杠路径不受影响', () => {
    expect(truncateMarkdown('保存到 C:\\temp 目录')).toBe('保存到 C:\\temp 目录');
  });

  it('紧凑预览单遍解码空格实体并折叠段内换行和连续空白', () => {
    expect(
      truncateMarkdownToCompactPlainText(
        '另一种形式的开\n始？\n\n&#x20;  没有死亡的人，无法给出答案。',
      ),
    ).toBe('另一种形式的开 始？ 没有死亡的人，无法给出答案。');
  });

  it('紧凑预览不会递归解码用户原本输入的实体文本', () => {
    expect(truncateMarkdownToCompactPlainText('&amp;lt;')).toBe('&lt;');
  });
});
