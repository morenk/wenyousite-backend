import MarkdownIt from 'markdown-it';
import { Prisma } from '@prisma/client';

const parser = new MarkdownIt({ html: false, linkify: false });
/** 遍历语法树，代码/转义不产生 image；保留普通图片重复出现的位置。 */
export function galleryImageUrls(content: string): string[] {
  const urls: string[] = [];
  for (const block of parser.parse(content, {})) {
    for (const token of block.children ?? []) {
      if (token.type !== 'image' || token.attrGet('title')?.startsWith('wenyousite-sticker:'))
        continue;
      const value = token.attrGet('src');
      if (!value) continue;
      try {
        const url = new URL(value);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.hostname === 'local.invalid'
        )
          continue;
      } catch {
        continue;
      }
      urls.push(value);
    }
  }
  return urls;
}
export async function syncGalleryIndex(
  tx: Prisma.TransactionClient,
  postId: string,
  content: string,
) {
  const urls = galleryImageUrls(content);
  await tx.postImageOccurrence.deleteMany({ where: { postId } });
  if (urls.length)
    await tx.postImageOccurrence.createMany({
      data: urls.map((url, imageIndex) => ({ postId, imageIndex, imageCount: urls.length, url })),
    });
  // 不改变 updatedAt：索引是正文事务内的派生状态，不构成正文编辑。
  await tx.$executeRaw`INSERT INTO post_gallery_indexes (post_id, content_transaction) VALUES (${postId}, txid_current()) ON CONFLICT (post_id) DO UPDATE SET content_transaction = EXCLUDED.content_transaction`;
}
