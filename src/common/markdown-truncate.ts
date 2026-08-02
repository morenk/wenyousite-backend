/** Markdown 安全截断：保证不在标记内部截断，尽量在句子或段落边界处 */
import removeMd from 'remove-markdown';

/** Milkdown 会转义、且 remove-markdown 会误判为语法的 ASCII 标点集合（与 unsafe.js 转义范围一致） */
const ESCAPE_CHARS = [...`!\"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`];
/** 转义标点 → 私有区占位符（0xE000 起逐个映射），remove-markdown 不会处理这些字符 */
const ESCAPE_MAP = new Map(ESCAPE_CHARS.map((c, i) => [c, String.fromCharCode(0xE000 + i)]));
/** 字面 < 占位符（0xE040，避开转义标点占位区间） */
const LT_PLACEHOLDER = '\uE040';
/** 全部私有区占位符 */
const PLACEHOLDER_RE = /[\uE000-\uE040]/g;

/** 清理后把占位符还原为原字符 */
function restorePlaceholders(s: string): string {
  return s.replace(PLACEHOLDER_RE, (ph) => {
    if (ph === LT_PLACEHOLDER) return '<';
    const idx = ph.charCodeAt(0) - 0xE000;
    return idx >= 0 && idx < ESCAPE_CHARS.length ? ESCAPE_CHARS[idx] : ph;
  });
}

/** 截取 Markdown 正文预览（50~100 字），避免在语法标记中间截断 */
export function truncateMarkdown(md: string, maxLen = 100, minLen = 50): string {
  if (!md) return '';

  // 图片只以统一占位进入摘要，避免 Milkdown 的比例 alt（如 1.00）泄漏为正文。
  const withImagePlaceholders = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]');
  // Milkdown 会把字面 < > * _ ` ~ 等转义为 \< \> \* ...。清理前先替换为私有区占位符，
  // 让 remove-markdown 只清理真正的 Markdown 语法：
  // - 避免转义标点被强调/删除线/行内代码等正则误删后残留孤立反斜杠（如 a\*b\*c 变成 a\b\c）
  // - 避免字面 < ... > 跨行被当成 HTML 标签整段吞掉（回复只有 < 和 > 时预览变空）
  // - 真实 Markdown（**加粗**、# 标题、> 引用等）仍照常清理
  const protectedContent = withImagePlaceholders
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => ESCAPE_MAP.get(c) ?? c)
    .replace(/</g, LT_PLACEHOLDER);
  const plain = restorePlaceholders(removeMd(protectedContent))
    // Milkdown 硬换行（行尾反斜杠 + 换行）还原为普通换行，避免预览残留字面 \。
    .replace(/\\\n/g, '\n')
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
