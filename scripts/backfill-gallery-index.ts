import { PrismaClient } from '@prisma/client';
import { galleryImageUrls, syncGalleryIndex } from '../src/image-gallery/gallery-index';
const prisma = new PrismaClient({ log: [] });
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--after=') && !arg.startsWith('--limit='))) throw new Error('非法参数');
  const apply = args.includes('--apply');
  const after = args.find((arg) => arg.startsWith('--after='))?.slice(8);
  const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.slice(8) ?? 250);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit 必须为 1–500');
  const rows = await prisma.post.findMany({ where: { galleryIndexed: false, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: 'asc' }, take: limit, select: { id: true, content: true } });
  let images = 0;
  let applied = 0;
  for (const row of rows) {
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM posts WHERE id = ${row.id} FOR UPDATE`;
        const current = await tx.post.findUnique({ where: { id: row.id }, select: { galleryIndexed: true, content: true } });
        if (!current || current.galleryIndexed) return;
        images += galleryImageUrls(current.content).length;
        await syncGalleryIndex(tx, row.id, current.content);
        applied++;
      });
    } else images += galleryImageUrls(row.content).length;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: rows.length, images, applied,
    nextAfter: rows.at(-1)?.id ?? null, batchLimit: limit }));
}
void main().catch(() => { console.error('图片位置索引回填失败；未输出正文或连接信息'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
