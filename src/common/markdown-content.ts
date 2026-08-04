/** Markdown 内容规则：判断正文是否包含可发布的可见内容 */

const EMPTY_IMAGE_RE = /!\[[^\]]*\]\(\s*\)/g;
const EMPTY_LINK_RE = /\[[^\]]*\]\(\s*\)/g;
const IMAGE_RE = /!\[[^\]]*\]\(\s*[^)\s]+[^)]*\)/;
const LINK_RE = /\[([^\]]+)\]\(\s*[^)\s]+[^)]*\)/g;
const HTML_RE = /<[^>]*>/g;
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

/** 判断 Markdown 是否含有文字、图片、代码或其他可见内容。 */
export function hasVisibleMarkdownContent(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  let fence: "`" | "~" | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const fenceMatch = rawLine.match(/^ {0,3}(`{3,}|~{3,})/);

    if (fence) {
      const closing = rawLine.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
      if (closing?.[1][0] === fence) fence = null;
      else if (line) return true;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1][0] as "`" | "~";
      continue;
    }

    if (!line || THEMATIC_BREAK_RE.test(rawLine)) continue;
    if (IMAGE_RE.test(line)) return true;

    const visible = line
      .replace(EMPTY_IMAGE_RE, "")
      .replace(EMPTY_LINK_RE, "")
      .replace(LINK_RE, "$1")
      .replace(HTML_RE, "")
      // 只移除 Markdown 前缀；不能把正文开头的纯数字（如 123、1.00）当成列表标记。
      .replace(/^[#>+\-\s]+/u, "")
      .replace(/^\d+[.)]\s*/u, "")
      .replace(/[*_~`]/g, "")
      .trim();
    if (visible) return true;
  }

  return false;
}
