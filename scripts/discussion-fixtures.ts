import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/** 仅由隔离 runner 在实际资源身份校验后，以受限应用角色调用。 */
export async function createDiscussionFixtures(db: PrismaClient, ownerUserId: string) {
  const actor = await db.$queryRawUnsafe<Array<{ current_user: string }>>('SELECT current_user');
  if (actor[0]?.current_user !== 'wenyousite_app') throw new Error('讨论样本必须使用受限应用角色');
  const other = await db.user.create({ data: { username: 'e2e_navigation_' + randomUUID(), email: randomUUID() + '@e2e.invalid', password: 'unused' } });
  const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const scenarios = [];
  for (const size of [1000, 5000, 10000]) {
    const thread = await db.thread.create({ data: { title: '隔离讨论样本 ' + size, ownerId: ownerUserId, category: category.slug, visibility: 'PUBLIC', published: true, publishedAt: new Date(), members: { create: [{ userId: ownerUserId, role: 'OWNER', playerMarked: true }, { userId: other.id, role: 'COLLABORATOR', playerMarked: true }] } } });
    const sub = await db.subthread.create({ data: { threadId: thread.id, title: '隔离长串 ' + size } });
    await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
    await db.post.create({ data: { authorId: ownerUserId, threadId: thread.id, subthreadId: sub.id, kind: 'BODY', content: '一次性长串浏览器测试样本' } });
    const root = await db.post.create({ data: { authorId: ownerUserId, threadId: thread.id, subthreadId: sub.id, floorNumber: 1, content: '隔离根楼' } });
    const common = { threadId: thread.id, subthreadId: sub.id };
    for (let start = 1; start <= size; start += 500) {
      const numbers = Array.from({ length: Math.min(500, size - start + 1) }, (_, i) => start + i);
      await db.post.createMany({ data: numbers.filter(number => number > 1).map(number => ({ ...common, authorId: number % 2 ? ownerUserId : other.id, floorNumber: number, content: '隔离主楼 #' + number + (number % 7 === 0 ? '\n\n用于验证不同内容高度的第二段。' : ''), pinnedAt: number === size - 1 ? new Date() : null })) });
      await db.post.createMany({ data: numbers.map(number => ({ ...common, authorId: number % 2 ? ownerUserId : other.id, parentPostId: root.id, replyNumber: number, content: '隔离回复 #' + number + (number % 7 === 0 ? '\n\n用于验证不同内容高度的第二段。' : '') })) });
    }
    const floor = (number: number) => db.post.findUniqueOrThrow({ where: { subthreadId_floorNumber: { subthreadId: sub.id, floorNumber: number } }, select: { id: true } });
    const reply = (number: number) => db.post.findUniqueOrThrow({ where: { parentPostId_replyNumber: { parentPostId: root.id, replyNumber: number } }, select: { id: true } });
    scenarios.push({ size, threadId: thread.id, subthreadId: sub.id, rootPostId: root.id, pinnedPostId: (await floor(size - 1)).id, editableFloorId: (await floor(3)).id, editableReplyId: (await reply(3)).id, otherAuthorFloorId: (await floor(2)).id, otherAuthorReplyId: (await reply(2)).id });
  }
  return { ownerUserId, otherUserId: other.id, scenarios };
}
