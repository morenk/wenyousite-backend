/** Markdown 安全截断：保证不在标记内部截断，尽量在句子或段落边界处 */
import removeMd from 'remove-markdown';

/** 截取 Markdown 正文预览（50~100 字），避免在语法标记中间截断 */
export function truncateMarkdown(md: string, maxLen = 100, minLen = 50): string {
  if (!md) return '';

  // 图片不进入通知摘要；先整体移除，避免 Milkdown 的比例 alt（如 1.00）泄漏为正文。
  const withoutImages = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const plain = removeMd(withoutImages).trim();
  if (plain.length <= maxLen) return plain;

  let cut = maxLen;

  // 优先在句末/换行处截断
  const chunk = plain.slice(0, cut + 20);
  const breakPoints = [
    chunk.lastIndexOf('\n'),
    chunk.lastIndexOf('。'),
    chunk.lastIndexOf('！'),
    chunk.lastIndexOf('？'),
  ].filter((p) => p >= minLen && p <= cut);

  if (breakPoints.length > 0) {
    cut = Math.max(...breakPoints) + 1; // +1 保留标点
  } else {
    // 不截断在单词中间（若英文/数字连写）
    while (cut > minLen && /\w/.test(plain[cut] || '')) cut--;
  }

  return plain.slice(0, cut).trimEnd() + '...';
}
