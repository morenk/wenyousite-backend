const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\(\s*([^\s)]+)(?:\s+["']([^"'\n]*)["'])?\s*\)/g;

function maskMarkdownCode(content: string): string {
  // RegExp 的 index 使用 UTF-16 code unit；split('') 保持同一索引体系，避免正文前的
  // emoji/代理对让代码区遮罩发生偏移。
  const chars = content.split('');
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      if (chars[index] !== '\n') chars[index] = ' ';
    }
  };

  for (const match of content.matchAll(
    /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?: {0,3})\1\s*$/gm,
  )) {
    mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  const withoutFencedCode = chars.join('');
  for (const match of withoutFencedCode.matchAll(/(`+)(?!`)([^\n]*?)\1(?!`)/g)) {
    mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  return chars.join('');
}

function isEscaped(content: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor--) {
    slashes++;
  }
  return slashes % 2 === 1;
}

interface MarkdownImage {
  url: string;
  title: string | null;
}

function extractMarkdownImages(content: string): MarkdownImage[] {
  if (!content) return [];

  const visible = maskMarkdownCode(content);
  const images: MarkdownImage[] = [];
  const seen = new Set<string>();
  for (const match of visible.matchAll(new RegExp(MARKDOWN_IMAGE_PATTERN.source, 'g'))) {
    if (isEscaped(visible, match.index ?? 0)) continue;

    const url = match[1].replace(/^<|>$/g, '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({ url, title: match[2] ?? null });
  }
  return images;
}

/** 提取代码边界外所有真实 Markdown 图片 URL，供媒体引用扫描复用。 */
export function extractMarkdownImageUrls(content: string): string[] {
  return extractMarkdownImages(content).map((image) => image.url);
}

/** 提取适合主题帖列表封面的普通 Markdown 图片，保持正文顺序并去重。 */
export function extractMarkdownCoverImages(content: string, limit = 3): string[] {
  if (!content || limit <= 0) return [];

  const urls: string[] = [];
  for (const { url, title } of extractMarkdownImages(content)) {
    // 畸形或旧版表情标记也不应在信息流中被放大为主题封面。
    if (!url || title?.includes('wenyousite-sticker:')) continue;

    urls.push(url);
    if (urls.length >= limit) break;
  }

  return urls;
}

/** 移除代码边界外的图片节点，供已有可视封面的卡片生成不重复的文字摘要。 */
export function stripVisibleMarkdownImages(content: string): string {
  if (!content) return '';

  const visible = maskMarkdownCode(content);
  const chars = content.split('');
  for (const match of visible.matchAll(new RegExp(MARKDOWN_IMAGE_PATTERN.source, 'g'))) {
    const start = match.index ?? 0;
    if (isEscaped(visible, start)) continue;
    for (let index = start; index < start + match[0].length; index++) {
      if (chars[index] !== '\n') chars[index] = ' ';
    }
  }
  return chars.join('');
}
