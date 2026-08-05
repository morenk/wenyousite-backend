/** Markdown v1 内容规则：规范化存储字符串并判断是否包含可发布内容 */

const EMPTY_IMAGE_RE = /!\[[^\]]*\]\(\s*\)/g;
const EMPTY_LINK_RE = /\[[^\]]*\]\(\s*\)/g;
const IMAGE_RE = /!\[[^\]]*\]\(\s*[^)\s]+[^)]*\)/;
const LINK_RE = /\[([^\]]+)\]\(\s*[^)\s]+[^)]*\)/g;
const HTTP_AUTOLINK_RE = /<https?:\/\/[^\s<>]+>/iu;
const HTML_RE = /<[^>]*>/g;
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
/** 仅用于可见性判断；保留原文，避免破坏 ZWJ Emoji 和变体选择符。 */
// eslint-disable-next-line no-misleading-character-class -- 此处按 Unicode code point 明确列举默认不可见字符及组合选择符。
const DEFAULT_IGNORABLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/gu;

/** 将跨端 Markdown 转为 v1 标准存储形式；不 trim、不做 Unicode 归一化。 */
export function normalizeMarkdownContent(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let fence: { marker: '`' | '~'; length: number } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceToken = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];

    if (fence) {
      const closingToken = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/)?.[1];
      if (
        closingToken?.[0] === fence.marker
        && closingToken.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }

    if (fenceToken) {
      fence = {
        marker: fenceToken[0] as '`' | '~',
        length: fenceToken.length,
      };
      continue;
    }

    if (/^ {0,3}<br\s*\/?>[\t ]*$/iu.test(line)) {
      lines[index] = '<br />';
      continue;
    }

    lines[index] = line.replace(EMPTY_IMAGE_RE, '');
  }

  return lines.join('\n');
}

function hasNonIgnorableText(value: string): boolean {
  return value.replace(DEFAULT_IGNORABLE_RE, '').trim().length > 0;
}

/** 判断 Markdown 是否含有文字、图片、代码或其他可见内容。 */
export function hasVisibleMarkdownContent(markdown: string): boolean {
  const lines = normalizeMarkdownContent(markdown).split('\n');
  let fence: { marker: '`' | '~'; length: number } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const fenceToken = rawLine.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];

    if (fence) {
      const closingToken = rawLine.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/)?.[1];
      if (
        closingToken?.[0] === fence.marker
        && closingToken.length >= fence.length
      ) {
        fence = null;
      } else if (hasNonIgnorableText(line)) {
        return true;
      }
      continue;
    }
    if (fenceToken) {
      fence = {
        marker: fenceToken[0] as '`' | '~',
        length: fenceToken.length,
      };
      continue;
    }

    if (!line || THEMATIC_BREAK_RE.test(rawLine)) continue;
    if (IMAGE_RE.test(line)) return true;
    // Milkdown 会把独占 URL 序列化为 CommonMark 自动链接；它不是 HTML 标签。
    if (HTTP_AUTOLINK_RE.test(line)) return true;

    const visible = line
      .replace(EMPTY_IMAGE_RE, "")
      .replace(EMPTY_LINK_RE, "")
      .replace(LINK_RE, "$1")
      .replace(HTML_RE, "")
      // 只移除 Markdown 前缀；不能把正文开头的纯数字（如 123、1.00）当成列表标记。
      .replace(/^[#>+\-\s]+/u, "")
      .replace(/^\d+[.)]\s*/u, "")
      .replace(/[*_~`]/g, "")
      .replace(DEFAULT_IGNORABLE_RE, '')
      .trim();
    if (visible) return true;
  }

  return false;
}
