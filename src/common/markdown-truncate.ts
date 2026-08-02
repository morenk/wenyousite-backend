/** Markdown 安全截断：保证不在标记内部截断，尽量在句子或段落边界处 */
import removeMd from 'remove-markdown';

/** 字面 < 的私有区占位符，防止 remove-markdown 把跨行 < ... > 误判为 HTML 标签 */
const LT_PLACEHOLDER = '\uE000';

/** 截取 Markdown 正文预览（50~100 字），避免在语法标记中间截断 */
export function truncateMarkdown(md: string, maxLen = 100, minLen = 50): string {
  if (!md) return '';

  // 图片只以统一占位进入摘要，避免 Milkdown 的比例 alt（如 1.00）泄漏为正文。
  const withImagePlaceholders = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]');
  // remove-markdown 会把字面 < ... > 跨行当成 HTML 标签整段吞掉（回复只有 < 和 > 时预览会变空）。
  // 先把 < 替换为私有区占位符，让 remove-markdown 只清理真正的 Markdown 标记。
  const protectedLt = withImagePlaceholders.replace(/</g, LT_PLACEHOLDER);
  // remove-markdown 不会把 \> 当引用，Milkdown 转义（\> → >、\< → < 等）在清理后还原即可。
  const plain = removeMd(protectedLt)
    .replace(new RegExp(LT_PLACEHOLDER, 'g'), '<')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
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
