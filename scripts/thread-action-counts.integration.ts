import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

type Detail = { bookmarkCount?: number; subscriberCount?: number; currentMembership?: unknown };
const db = new PrismaClient({ log: [] });

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.THREAD_ACTION_COUNTS_TEST_ENV, 'test');
  const createUser = () => db.user.create({ data: {
    username: 'counts_' + randomUUID().slice(0, 12), email: randomUUID() + '@counts.invalid',
    password: 'unused-isolated-fixture',
  } });
  const [owner, viewer, player, departed, collaborator] = await Promise.all(Array.from({ length: 5 }, createUser));
  const thread = await db.thread.create({ data: {
    ownerId: owner.id, title: '隔离互动总数', published: true,
    members: { create: [
      { userId: owner.id, role: 'OWNER', playerMarked: true },
      { userId: player.id, role: 'PARTICIPANT', playerMarked: true },
      { userId: collaborator.id, role: 'COLLABORATOR' },
    ] },
  } });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const request = async <T>(path: string, userId?: string, method = 'GET', status = 200, data?: unknown): Promise<T> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const response = await fetch(process.env.API_BASE + path, {
      method, headers: { ...(data ? { 'content-type': 'application/json' } : {}),
        ...(userId ? { authorization: 'Bearer ' + jwt.sign({ sub: userId }, { expiresIn: '5m' }) } : {}),
      }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, status, `${method} 隔离接口状态码`);
    const body = await response.json() as { data: T };
    return body.data;
  };
  const counts = async (bookmarks: number, subscribers: number, userId?: string) => {
    const detail = await request<Detail>(`/threads/${thread.id}`, userId);
    assert.equal(detail.bookmarkCount, bookmarks, '新后端必须返回真实收藏人数，含零');
    assert.equal(detail.subscriberCount, subscribers, '新后端必须返回真实显式 THREAD 订阅人数，含零');
    assert(!('bookmarks' in detail) && !('subscriptions' in detail), '不泄露用户关系列表');
  };
  const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    AND indexname IN ('user_bookmarks_thread_idx', 'subscriptions_thread_type_target_idx')`;
  assert.equal(indexes.length, 2, '只增索引迁移必须已生效');
  await counts(0, 0); // 预热匿名详情缓存，后续所有匿名读仍必须反映已提交关系。
  await counts(0, 0, owner.id); // 自动通知的楼主和协作者不计人数。
  await request('/bookmarks', undefined, 'POST', 401, { threadId: thread.id });
  await request('/subscriptions', undefined, 'POST', 401, { threadId: thread.id, type: 'THREAD' });
  const bookmark = await request<{ id: string }>('/bookmarks', viewer.id, 'POST', 201, { threadId: thread.id });
  const subscription = await request<{ id: string }>('/subscriptions', viewer.id, 'POST', 201, { threadId: thread.id, type: 'THREAD' });
  await counts(1, 1);
  await counts(1, 1, viewer.id);
  await request('/bookmarks', viewer.id, 'POST', 409, { threadId: thread.id });
  await request('/subscriptions', viewer.id, 'POST', 409, { threadId: thread.id, type: 'THREAD' });
  await request('/subscriptions', viewer.id, 'POST', 201, { threadId: thread.id, type: 'USER', targetUserId: player.id });
  await counts(1, 1); // 同用户的 USER 订阅不能重复计入；纯 USER 也不能计入。
  await request('/subscriptions', departed.id, 'POST', 201, { threadId: thread.id, type: 'USER', targetUserId: player.id });
  await counts(1, 1);
  const folder = await request<{ id: string }>('/bookmarks/folders', viewer.id, 'POST', 201, { name: '隔离目录' });
  await request(`/bookmarks/${bookmark.id}`, viewer.id, 'PATCH', 200, { folderId: folder.id });
  await counts(1, 1);
  await request('/bookmarks', departed.id, 'POST', 201, { threadId: thread.id });
  await request('/subscriptions', departed.id, 'POST', 201, { threadId: thread.id, type: 'THREAD' });
  await counts(2, 2);
  await db.user.update({ where: { id: departed.id }, data: { deletedAt: new Date() } });
  await counts(1, 1);
  assert.equal(await db.userBookmark.count({ where: { threadId: thread.id } }), 2, '注销关系保留但不计入');
  // 后续成为协作者但仍保留的显式订阅按关系计入，不按角色另减人数。
  await db.threadMember.create({ data: { threadId: thread.id, userId: viewer.id, role: 'COLLABORATOR' } });
  await counts(1, 1);
  await db.userBlock.create({ data: { blockerId: player.id, blockedId: viewer.id } });
  await counts(1, 1, player.id); // 汇总没有用户身份，查看者与关系用户拉黑不改变真实总数。
  await request(`/bookmarks/${bookmark.id}`, player.id, 'DELETE', 404);
  await request(`/subscriptions/${subscription.id}`, player.id, 'DELETE', 404);
  await counts(1, 1);
  await request(`/bookmarks/${bookmark.id}`, viewer.id, 'DELETE');
  await request(`/subscriptions/${subscription.id}`, viewer.id, 'DELETE');
  await counts(0, 0);
  await assert.rejects(db.$transaction(async tx => {
    await tx.userBookmark.create({ data: { userId: viewer.id, threadId: thread.id, folderId: folder.id } });
    await tx.subscription.create({ data: { userId: viewer.id, threadId: thread.id, type: 'THREAD' } });
    throw new Error('isolated-rollback');
  }), /isolated-rollback/);
  await counts(0, 0);
  await db.thread.update({ where: { id: thread.id }, data: { visibility: 'PRIVATE' } });
  await request(`/threads/${thread.id}`, undefined, 'GET', 404);
  const outsider = await createUser();
  await request(`/threads/${thread.id}`, outsider.id, 'GET', 404);
  await counts(0, 0, viewer.id);
  await db.thread.update({ where: { id: thread.id }, data: { published: false } });
  await request(`/threads/${thread.id}`, viewer.id, 'GET', 404);
  await counts(0, 0, owner.id);
  await db.thread.update({ where: { id: thread.id }, data: { deletedAt: new Date() } });
  await request(`/threads/${thread.id}`, owner.id, 'GET', 404);
  console.log('通过：索引迁移、真实零值、匿名缓存更新、收藏移动/取消、显式订阅去重、注销排除、回滚及权限拒绝');
}
void main().catch((error: unknown) => { console.error(error instanceof assert.AssertionError ? { message: error.message, actual: error.actual, expected: error.expected } : { errorType: error instanceof Error ? error.constructor.name : 'UnknownError' }); console.error('主题互动总数隔离验证失败'); process.exitCode = 1; }).finally(() => db.$disconnect());
