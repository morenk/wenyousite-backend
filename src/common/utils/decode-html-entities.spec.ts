import { decodeEntities } from './decode-html-entities';

describe('decodeEntities（单遍实体解码）', () => {
  it('还原被转义的基本实体', () => {
    expect(decodeEntities('这是 &gt; 符号')).toBe('这是 > 符号');
    expect(decodeEntities('a &lt; b')).toBe('a < b');
    expect(decodeEntities('A &amp; B')).toBe('A & B');
  });

  it('复合实体只解码一次，不递归', () => {
    // 用户原本输入 &gt; → 后端编码 &amp;gt; → 单遍解码还原 &gt;
    expect(decodeEntities('&amp;gt;')).toBe('&gt;');
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });

  it('混合内容正确还原', () => {
    expect(decodeEntities('&gt; 引用\n普通 a > b 与 A &amp; B')).toBe(
      '> 引用\n普通 a > b 与 A & B',
    );
  });

  it('数字实体解码', () => {
    expect(decodeEntities('&#62;')).toBe('>');
    expect(decodeEntities('&#x3E;')).toBe('>');
  });

  it('不误伤无分号结尾的普通文本', () => {
    expect(decodeEntities('100% & 200')).toBe('100% & 200');
  });

  it('空字符串原样返回', () => {
    expect(decodeEntities('')).toBe('');
  });
});
