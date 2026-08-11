import { STICKER_MARKER_PREFIX } from '../stickers/sticker.constants';
import {
  extractMarkdownCoverImages,
  extractMarkdownImageUrls,
  stripVisibleMarkdownImages,
} from './markdown-cover-images';

describe('extractMarkdownCoverImages', () => {
  it('只提取正文中第一张普通图片', () => {
    const content = [
      '![一](https://cdn.example.com/one.jpg)',
      '![重复](https://cdn.example.com/one.jpg)',
      '![二](https://cdn.example.com/two.png "说明")',
      '![三](<https://cdn.example.com/three.webp>)',
      '![四](https://cdn.example.com/four.jpg)',
    ].join('\n');

    expect(extractMarkdownCoverImages(content)).toEqual(['https://cdn.example.com/one.jpg']);
  });

  it('忽略收藏表情、代码块、行内代码和转义图片语法', () => {
    const content = [
      `![表情](https://cdn.example.com/sticker.webp "${STICKER_MARKER_PREFIX}asset-1")`,
      '![旧表情](https://cdn.example.com/legacy.webp "wenyousite-sticker:broken")',
      '`![行内](https://cdn.example.com/inline.jpg)`',
      '```md',
      '![代码块](https://cdn.example.com/fenced.jpg)',
      '```',
      '\\![转义](https://cdn.example.com/escaped.jpg)',
      '![封面](https://cdn.example.com/cover.jpg)',
    ].join('\n');

    expect(extractMarkdownCoverImages(content)).toEqual(['https://cdn.example.com/cover.jpg']);
  });

  it('emoji 不会让后续代码区遮罩索引偏移', () => {
    const content = [
      '🎲 示例 `![代码](https://cdn.example.com/inline.jpg)`',
      '![封面](https://cdn.example.com/cover.jpg)',
    ].join('\n');

    expect(extractMarkdownCoverImages(content)).toEqual(['https://cdn.example.com/cover.jpg']);
  });

  it('空正文返回空数组', () => {
    expect(extractMarkdownCoverImages('')).toEqual([]);
  });

  it('引用扫描统一支持尖括号 URL，并忽略代码与转义图片', () => {
    const content = [
      '![普通](https://cdn.example.com/a.jpg)',
      '![尖括号](<https://cdn.example.com/b.jpg>)',
      '`![代码](https://cdn.example.com/code.jpg)`',
      '\\![转义](https://cdn.example.com/escaped.jpg)',
    ].join('\n');

    expect(extractMarkdownImageUrls(content)).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
    ]);
  });

  it('为封面卡片移除可见图片节点但保留代码和转义内容', () => {
    const content = [
      '正文 ![封面](https://cdn.example.com/a.jpg)',
      '`![示例](https://cdn.example.com/code.jpg)`',
      '\\![字面量](https://cdn.example.com/escaped.jpg)',
    ].join('\n');

    const stripped = stripVisibleMarkdownImages(content);
    expect(stripped).not.toContain('https://cdn.example.com/a.jpg');
    expect(stripped).toContain('`![示例](https://cdn.example.com/code.jpg)`');
    expect(stripped).toContain('\\![字面量](https://cdn.example.com/escaped.jpg)');
  });
});
