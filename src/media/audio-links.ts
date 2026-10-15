import MarkdownIt from 'markdown-it';
const parser = new MarkdownIt({ html: false, linkify: false });

/** 真正的普通链接节点；代码、转义和图片不是音频引用。 */
export function extractMarkdownAudioLinks(content: string): string[] {
  const urls = new Set<string>();
  for (const block of parser.parse(content, {})) {
    for (const token of block.children ?? []) {
      if (token.type !== 'link_open') continue;
      const href = token.attrGet('href');
      if (href && /^https:\/\//.test(href) && /\/media\/audio\//.test(href)) urls.add(href);
    }
  }
  return [...urls];
}
