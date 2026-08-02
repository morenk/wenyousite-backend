/** Markdown 安全截断：保证不在标记内部截断，尽量在句子或段落边界处 */
import removeMd from 'remove-markdown';

/** 截取 Markdown 正文预览（50~100 字），避免在语法标记中间截断 */
export function truncateMarkdown(md: string, maxLen = 100, minLen = 50): string {
  if (!md) return '';

  // Milkdown 序列化会把可能被误解析为 HTML 标签 / 引用的 < > 等标点转义为 \< \>。
  // 除 \> 外先还原（让 remove-markdown 能正确识别并清理标签），
  // 否则清理后会残留孤立反斜杠（如预览出现 \> 或 \代码\）。
  // \> 必须保留到清理之后再还原：字面 > 一旦还原会被误判成引用整行剥掉，回复只剩 > 时预览会变空。
  const unescaped = md.replace(/\\(?!>)([!-/:-@[-`{-~])/g, '$1');
  // 图片只以统一占位进入摘要，避免 Milkdown 的比例 alt（如 1.00）泄漏为正文。
  const withImagePlaceholders = unescaped.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]');
  // remove-markdown 不会把 \> 当引用，清理后还原为字面 >。
  const plain = removeMd(withImagePlaceholders).trim().replace(/\\>/g, '>');
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
