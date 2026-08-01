import { PrismaClient } from '@prisma/client';

/** 一次性回填脚本：为缺失 bodyPostId 的未删除 subthread 回填其首个非回复楼层 */
const prisma = new PrismaClient();

async function main() {
  const subthreads = await prisma.subthread.findMany({
    where: { bodyPostId: null, deletedAt: null },
    select: { id: true },
  });

  const subthreadIds = subthreads.map((s) => s.id);
  const posts = await prisma.post.findMany({
    where: {
      subthreadId: { in: subthreadIds },
      parentPostId: null,
      deletedAt: null,
    },
    select: { id: true, subthreadId: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const candidates = new Map<string, string>();
  for (const post of posts) {
    if (!candidates.has(post.subthreadId)) {
      candidates.set(post.subthreadId, post.id);
    }
  }

  let fixed = 0;
  let skipped = 0;

  for (const subthread of subthreads) {
    const postId = candidates.get(subthread.id);
    if (!postId) {
      skipped += 1;
      continue;
    }
    await prisma.subthread.update({
      where: { id: subthread.id },
      data: { bodyPostId: postId },
    });
    fixed += 1;
  }

  console.log(`检查 subthread: ${subthreads.length}`);
  console.log(`修复 subthread: ${fixed}`);
  console.log(`跳过 subthread: ${skipped}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
