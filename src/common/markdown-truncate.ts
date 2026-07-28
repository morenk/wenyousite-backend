/** Markdown 安全截断：保证不在标记内部截断，尽量在句子或段落边界处 */
import removeMd from 'remove-markdown';

/** 截取 Markdown 正文预览（50~100 字），避免在语法标记中间截断 */
export function truncateMarkdown(md: string, maxLen = 100, minLen = 50): string {
  if (!md || md.length <= maxLen) return md || '';

  // 先去纯文本
  const plain = removeMd(md).trim();
  if (plain.length <= maxLen) return plain;

  // 在 maxLen 附近寻找合适截断点
  let cut = maxLen;
  if (cut > plain.length) cut = plain.length;

  // 优先在句末/换行处截断
  const chunk = plain.slice(0, cut + 20);
  const breakPoints = [
    chunk.lastIndexOf('\n'),
    chunk.lastIndexOf('。'),
    chunk.lastIndexOf('！'),
    chunk.lastIndexOf('？'),
    chunk.lastIndexOf('\n\n'),
  ].filter((p) => p >= minLen && p <= cut);

  if (breakPoints.length > 0) {
    cut = Math.max(...breakPoints) + 1; // +1 保留标点
  } else {
    // 不截断在单词中间（若英文/数字连写）
    while (cut > minLen && /\w/.test(plain[cut] || '')) cut--;
  }

  return plain.slice(0, cut) + '...';
}
