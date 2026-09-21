import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { syncGalleryIndex } from '../src/image-gallery/gallery-index';

const db = new PrismaClient({ log: [] });
async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.IMAGE_GALLERY_TEST_ENV, 'test');
  const viewer = process.env.E2E_USER_ID!;
  const token = new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign({ sub: viewer }, { expiresIn: '5m' });
  const query = async (params: Record<string, string | number>, auth = token) => {
    await new Promise(resolve => setTimeout(resolve, 140));
    const response = await fetch(process.env.API_BASE + '/image-gallery?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])), {
      headers: auth ? { authorization: 'Bearer ' + auth } : {},
    });
    const body = await response.json() as { code: number; data: { items: { id: string; sourceId: string; imageIndex: number; mediaId: string | null }[]; nextCursor: string | null; previousCursor: string | null } };
    assert.notEqual(response.status, 500, '图库接口不得返回内部错误');
    return { status: response.status, ...body };
  };
  const owner = await db.user.create({ data: { username: 'gallery_' + randomUUID().slice(0, 8), email: randomUUID() + '@gallery.invalid', password: 'unused' } });
  const other = await db.user.create({ data: { username: 'gallery_' + randomUUID().slice(0, 8), email: randomUUID() + '@gallery.invalid', password: 'unused' } });
  const thread = await db.thread.create({ data: { ownerId: owner.id, title: '图库隔离用例', published: true, members: { create: { userId: owner.id, role: 'OWNER' } } } });
  const sub = await db.subthread.create({ data: { threadId: thread.id, title: '子贴' } });
  const otherSub = await db.subthread.create({ data: { threadId: thread.id, title: '其他子贴' } });
  const old = new Date(Date.now() - 60000);
  const post = async (content: string, extra = {}) => db.$transaction(async tx => {
    const row = await tx.post.create({ data: { threadId: thread.id, subthreadId: sub.id, authorId: owner.id, content, createdAt: old, updatedAt: old, ...extra } });
    await syncGalleryIndex(tx, row.id, content);
    return row;
  });
  const image = '![图](https://example.test/gallery.png)';
  const body = await post(image + '\n' + image, { kind: 'BODY' });
  const floor = await post(image, { floorNumber: 1 });
  const pin = await post(image, { floorNumber: 2, pinnedAt: old });
  const reply = await post(image, { parentPostId: floor.id });
  const otherFloor = await post(image, { floorNumber: 3, authorId: other.id });
  await post(image, { subthreadId: otherSub.id, floorNumber: 1 });
  // 连续无图楼层不能中断索引分页，也不把全部正文取到客户端。
  for (let n = 4; n < 30; n++) await post('无图', { floorNumber: n });
  const last = await post(image, { floorNumber: 30 });
  const base = { scope: 'SUBTHREAD', scopeId: sub.id, order: 'OLDEST', limit: 2 };
  const first = await query({ ...base, anchorId: body.id, anchorIndex: 0, anchorVersion: 1 });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.items.map(i => i.sourceId), [body.id, body.id]);
  assert(first.data.nextCursor);
  const after = await query({ ...base, cursor: first.data.nextCursor });
  assert.deepEqual(after.data.items.map(i => i.sourceId), [pin.id, floor.id]);
  const final = await query({ ...base, cursor: after.data.nextCursor! });
  assert.deepEqual(final.data.items.map(i => i.sourceId), [otherFloor.id, last.id]);
  assert.equal(final.data.nextCursor, null);
  const back = await query({ ...base, cursor: final.data.previousCursor! });
  assert.deepEqual(back.data.items.map(i => i.sourceId), [pin.id, floor.id]);
  assert.equal((await query({ ...base, cursor: first.data.nextCursor }, '')).status, 400, '游标绑定查看者');
  assert.equal((await query({ ...base, order: 'NEWEST', cursor: first.data.nextCursor })).status, 400);
  assert.equal((await query({ ...base, cursor: first.data.nextCursor + 'x' })).status, 400);
  assert.equal((await query({ ...base, limit: 51, anchorId: body.id, anchorIndex: 0, anchorVersion: 1 })).status, 400);
  // 置顶位置在会话内冻结；不因自动 updatedAt 误判正文编辑。
  await db.post.update({ where: { id: pin.id }, data: { pinnedAt: null } });
  await db.post.update({ where: { id: last.id }, data: { pinnedAt: new Date() } });
  const frozen = await query({ ...base, cursor: first.data.nextCursor });
  assert.equal(frozen.status, 200);
  assert.deepEqual(frozen.data.items.map(i => i.sourceId), [pin.id, floor.id]);
  const late = await post(image, { floorNumber: 31, createdAt: new Date() });
  assert(!(await query({ ...base, cursor: after.data.nextCursor! })).data.items.some(i => i.sourceId === late.id));
  const replies = await query({ scope: 'POST_REPLIES', scopeId: floor.id, anchorId: reply.id, anchorIndex: 0, anchorVersion: 1 });
  assert.deepEqual(replies.data.items.map(i => i.sourceId), [reply.id]);
  const tied = [reply];
  for (let index = 0; index < 3; index++) tied.push(await post(image + '\n' + image, { parentPostId: floor.id }));
  tied.sort((a, b) => a.id < b.id ? -1 : 1);
  for (const order of ['OLDEST', 'NEWEST']) {
    const ordered = order === 'OLDEST' ? tied : [...tied].reverse();
    const expected = ordered.flatMap(row => Array.from({ length: row.id === reply.id ? 1 : 2 }, (_, index) => `post:${row.id}:1:${index}`));
    const context = { scope: 'POST_REPLIES', scopeId: floor.id, order, limit: 2 };
    const opened = await query({ ...context, anchorId: ordered[1].id, anchorIndex: 0, anchorVersion: 1 });
    let items = opened.data.items;
    let previous = opened.data.previousCursor;
    let next = opened.data.nextCursor;
    for (let guard = 0; previous && guard < 10; guard++) {
      const page = await query({ ...context, cursor: previous });
      items = [...page.data.items, ...items]; previous = page.data.previousCursor;
    }
    for (let guard = 0; next && guard < 10; guard++) {
      const page = await query({ ...context, cursor: next });
      items = [...items, ...page.data.items]; next = page.data.nextCursor;
    }
    assert.equal(previous, null); assert.equal(next, null);
    assert.deepEqual(items.map(item => item.id), expected, '同时间戳双向分页无遗漏或重复，正文内部始终正序');
  }

  assert.equal((await query({ ...base, anchorId: reply.id, anchorIndex: 0, anchorVersion: 1 })).status, 404);
  const filtered = await query({ ...base, authorId: owner.id, anchorId: body.id, anchorIndex: 0, anchorVersion: 1, limit: 50 });
  assert(!filtered.data.items.some(i => i.sourceId === otherFloor.id));
  await db.userBlock.create({ data: { blockerId: viewer, blockedId: other.id } });
  assert.equal((await query({ ...base, anchorId: otherFloor.id, anchorIndex: 0, anchorVersion: 1 })).status, 404);
  await db.thread.update({ where: { id: thread.id }, data: { visibility: 'PRIVATE' } });
  assert.equal((await query({ ...base, cursor: first.data.nextCursor })).status, 404);
  await db.thread.update({ where: { id: thread.id }, data: { visibility: 'PUBLIC' } });
  const unindexed = await db.post.create({ data: { threadId: thread.id, subthreadId: sub.id, authorId: owner.id, content: image, floorNumber: 32 } });
  const notReady = await query({ ...base, anchorId: body.id, anchorIndex: 0, anchorVersion: 1 });
  assert.equal(notReady.status, 409); assert.equal(notReady.code, 40924);
  await db.$transaction(tx => syncGalleryIndex(tx, unindexed.id, image));
  await new Promise(resolve => setTimeout(resolve, 5));
  await db.$transaction(async tx => {
    await tx.post.update({ where: { id: floor.id }, data: { content: image + '\n' + image, version: { increment: 1 } } });
    await syncGalleryIndex(tx, floor.id, image + '\n' + image);
  });
  assert.equal((await query({ ...base, cursor: first.data.nextCursor })).status, 409, '编辑已存在正文不能向会话静默插图');
  assert.equal((await query({ ...base, anchorId: floor.id, anchorIndex: 0, anchorVersion: 1 })).status, 409);
  await db.post.update({ where: { id: floor.id }, data: { deletedAt: new Date() } });
  assert.equal((await query({ scope: 'POST_REPLIES', scopeId: floor.id, anchorId: reply.id, anchorIndex: 0, anchorVersion: 1 })).status, 404);
  const media = async (purpose: 'MOMENT' | 'MOMENT_COMMENT') => db.media.create({ data: {
    userId: owner.id, url: 'https://example.test/' + randomUUID() + '.png', key: randomUUID(), purpose, status: 'COMPLETED', contentType: 'image/png',
  } });
  const assets = await Promise.all([media('MOMENT'), media('MOMENT'), media('MOMENT_COMMENT'), media('MOMENT_COMMENT')]);
  const moment = await db.moment.create({ data: { authorId: owner.id, title: '动态图集', clientRequestId: randomUUID(), createRequestHash: 'fixture',
    images: { create: assets.slice(0, 2).map((asset, sortOrder) => ({ mediaId: asset.id, sortOrder })) } } });
  const comment = await db.momentComment.create({ data: { momentId: moment.id, authorId: owner.id, content: '', mediaId: assets[2].id, clientRequestId: randomUUID(), createRequestHash: 'fixture' } });
  const commentReply = await db.momentComment.create({ data: { momentId: moment.id, authorId: owner.id, parentCommentId: comment.id, content: '', mediaId: assets[3].id, clientRequestId: randomUUID(), createRequestHash: 'fixture' } });
  const m = await query({ scope: 'MOMENT', scopeId: moment.id, anchorId: moment.id, anchorIndex: 0, anchorVersion: 1 });
  assert.equal(m.status, 200); assert.equal(m.data.items.length, 2);
  assert.deepEqual(m.data.items.map(i => i.mediaId), assets.slice(0, 2).map(a => a.id));
  const c = await query({ scope: 'MOMENT_COMMENTS', scopeId: moment.id, anchorId: comment.id, anchorIndex: 0, anchorVersion: 1 });
  assert.deepEqual(c.data.items.map(i => i.sourceId), [comment.id]);
  const r = await query({ scope: 'MOMENT_REPLIES', scopeId: comment.id, anchorId: commentReply.id, anchorIndex: 0, anchorVersion: 1 });
  assert.deepEqual(r.data.items.map(i => i.sourceId), [commentReply.id]);
  await db.momentComment.update({ where: { id: comment.id }, data: { deletedAt: new Date(), removalSource: 'AUTHOR', mediaId: null } });
  assert.equal((await query({ scope: 'MOMENT_REPLIES', scopeId: comment.id, anchorId: commentReply.id, anchorIndex: 0, anchorVersion: 1 })).status, 200);
  await db.momentComment.update({ where: { id: comment.id }, data: { removalSource: 'ADMIN' } });
  assert.equal((await query({ scope: 'MOMENT_REPLIES', scopeId: comment.id, anchorId: commentReply.id, anchorIndex: 0, anchorVersion: 1 })).status, 404);
  await db.userBlock.create({ data: { blockerId: owner.id, blockedId: viewer } });
  assert.equal((await query({ scope: 'MOMENT', scopeId: moment.id, anchorId: moment.id, anchorIndex: 0, anchorVersion: 1 })).status, 404);
  console.log(JSON.stringify({ gallery: 'passed', runId: process.env.E2E_RUN_ID, cases: 'pagination/scopes/identity/pins/snapshot/edits/blocks/private/deletes/index-readiness' }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : '图集验证失败'); process.exitCode = 1; }).finally(() => db.$disconnect());
