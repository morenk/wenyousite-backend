import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/prisma/prisma.service';
import { ThreadAccessService } from '../src/access/thread-access.service';
import { PostQueryService } from '../src/posts/post-query.service';
import { DiscussionWindowService } from '../src/posts/discussion-window.service';
import { ReplyOrder } from '../src/common/dto/reply-query.dto';

const MIGRATION = '20261001090000_discussion_reply_number';
let queries = 0;
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
db.$on('query', event => { queries++; if (event.duration > 250) console.log(JSON.stringify({ event: 'slow-query', milliseconds: event.duration, sql: event.query.slice(0, 240) })); });
async function verifyMigration() {
  const database = 'wenyousite_navigation_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL!); url.pathname = '/' + database;
  const legacy = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const root = await mkdtemp(join(dirname(process.env.E2E_MANIFEST!), 'navigation-migration-'));
  let created = false;
  const deploy = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root, 'schema.prisma')], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() }, stdio: 'pipe' });
  try {
    await db.$executeRawUnsafe('CREATE DATABASE "' + database + '"'); created = true;
    await mkdir(join(root, 'migrations')); await cp('prisma/schema.prisma', join(root, 'schema.prisma'));
    for (const name of await readdir('prisma/migrations')) if (name !== MIGRATION) await cp(join('prisma/migrations', name), join(root, 'migrations', name), { recursive: true });
    deploy();
    const user = await legacy.user.create({ data: { username: 'legacy_' + randomUUID(), email: randomUUID() + '@navigation.invalid', password: 'unused' } });
    const thread = await legacy.thread.create({ data: { title: '迁移样本', ownerId: user.id } });
    const sub = await legacy.subthread.create({ data: { threadId: thread.id, title: '子贴' } });
    const prefix = randomUUID(); const rootId = prefix + '_root'; const old = new Date('2026-01-01T00:00:00.000Z');
    await legacy.$executeRaw`INSERT INTO posts (id, thread_id, subthread_id, author_id, content, kind, floor_number, created_at, updated_at, lock_version)
      VALUES (${rootId}, ${thread.id}, ${sub.id}, ${user.id}, '历史主楼', 'FLOOR', 7, ${old}, ${old}, 4)`;
    for (const suffix of ['c', 'a', 'b']) {
      const id = prefix + '_' + suffix; const deleted = suffix === 'b' ? old : null;
      await legacy.$executeRaw`INSERT INTO posts (id, thread_id, subthread_id, author_id, parent_post_id, content, kind, deleted_at, created_at, updated_at, lock_version)
        VALUES (${id}, ${thread.id}, ${sub.id}, ${user.id}, ${rootId}, '历史回复', 'FLOOR', ${deleted}, ${old}, ${old}, 3)`;
    }
    await cp(join('prisma/migrations', MIGRATION), join(root, 'migrations', MIGRATION), { recursive: true });
    deploy();
    const replies = await legacy.post.findMany({ where: { parentPostId: rootId }, orderBy: { replyNumber: 'asc' } });
    assert.deepEqual(replies.map(p => [p.id.slice(-1), p.replyNumber]), [['a', 1], ['b', 2], ['c', 3]]);
    assert(replies[1].deletedAt); assert(replies.every(p => p.version === 3 && p.createdAt.getTime() === old.getTime()));
    assert.equal((await legacy.post.findUniqueOrThrow({ where: { id: rootId } })).floorNumber, 7);
    deploy();
    assert.equal(await legacy.post.count({ where: { parentPostId: rootId, replyNumber: { not: null } } }), 3);
    const legacyWrite = await legacy.post.create({ data: { threadId: thread.id, subthreadId: sub.id, authorId: user.id, parentPostId: rootId, content: '旧客户端兼容写入' } });
    assert.equal(legacyWrite.replyNumber, 4);
  } finally {
    await legacy.$disconnect();
    if (created) await db.$executeRawUnsafe('DROP DATABASE "' + database + '"');
    await rm(root, { recursive: true });
  }
}
async function main() {
  await verifyIsolatedEnvironment(); assert.equal(process.env.DISCUSSION_NAVIGATION_TEST_ENV, 'test');
  await verifyMigration();
  const viewer = process.env.E2E_USER_ID!;
  const token = new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign({ sub: viewer }, { expiresIn: '15m' });
  const request = async (path: string, expected = 200, body?: unknown) => {
    const response = await fetch(process.env.API_BASE + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, expected, path + ' HTTP status');
    return await response.json() as { code: number; data: any };
  };
  const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
  const other = await db.user.create({ data: { username: 'other_' + randomUUID(), email: randomUUID() + '@navigation.invalid', password: 'unused' } });
  const thread = await db.thread.create({ data: { title: '定位隔离样本', ownerId: viewer, category: category.slug, published: true, members: { create: [{ userId: viewer, role: 'OWNER' }, { userId: other.id, role: 'COLLABORATOR' }] } } });
  const sub = await db.subthread.create({ data: { threadId: thread.id, title: '万楼子贴' } });
  const root = await db.post.create({ data: { authorId: viewer, threadId: thread.id, subthreadId: sub.id, floorNumber: 1, content: '根楼', pinnedAt: new Date() } });
  const prisma = db as unknown as PrismaService;
  const access = new ThreadAccessService(prisma);
  const service = new DiscussionWindowService(prisma, new PostQueryService(prisma, access), new ConfigService({ jwt: { accessSecret: process.env.JWT_ACCESS_SECRET } }));
  let count = 0;
  const metrics = [];
  for (const size of [1000, 5000, 10000]) {
    while (count < size) {
      const end = Math.min(count + 500, size);
      await db.post.createMany({ data: Array.from({ length: end - count }, (_, i) => ({ threadId: thread.id, subthreadId: sub.id, parentPostId: root.id, authorId: (count + i + 1) % 2 ? viewer : other.id, replyNumber: count + i + 1, content: '压力样本 ' + (count + i + 1) })) });
      count = end;
    }
    const timings = []; const sqlCounts = [];
    for (const number of [1, Math.floor(size / 2), size]) {
      queries = 0; const started = performance.now();
      const result = await service.find('replies', root.id, { number }, viewer);
      timings.push(Math.round((performance.now() - started) * 100) / 100); sqlCounts.push(queries);
      assert.equal(result.total, size); assert.equal(result.maxNumber, size);
      assert(result.items.some(p => p.replyNumber === number)); assert(result.items.length <= 20);
      assert(queries <= 20, '查询数不能随编号增长，实际=' + queries); assert(timings.at(-1)! < 5000);
    }
    metrics.push({ size, positions: ['first', 'middle', 'last'], milliseconds: timings, sqlCounts });
  }
  const middle = await service.find('replies', root.id, { number: 5000 }, viewer);
  const next = await service.find('replies', root.id, { cursor: middle.afterCursor! }, viewer);
  assert(next.items.every(p => p.replyNumber! > middle.items.at(-1)!.replyNumber!));
  const previous = await service.find('replies', root.id, { cursor: next.beforeCursor! }, viewer);
  assert.deepEqual(previous.items.map(p => p.id), middle.items.map(p => p.id));
  const newest = await service.find('replies', root.id, { number: 5000, order: ReplyOrder.NEWEST }, viewer);
  assert(newest.items.every((p, i, a) => i === 0 || a[i - 1].replyNumber! > p.replyNumber!));
  const last = await db.post.findFirstOrThrow({ where: { parentPostId: root.id, replyNumber: 10000 } });
  await db.post.update({ where: { id: last.id }, data: { deletedAt: new Date() } });
  await request('/posts/' + root.id + '/replies/window?number=10000', 404);
  const filtered = await request('/posts/' + root.id + '/replies/window?number=5000&authorId=' + viewer, 409);
  assert.equal(filtered.code, 40010);
  await request('/posts/' + root.id + '/replies/window?number=1&postId=' + middle.target!.id, 400);
  await request('/posts/' + root.id + '/replies/window?cursor=' + encodeURIComponent(middle.afterCursor!) + '&order=NEWEST', 400);
  const wire = (await request('/posts/' + root.id + '/replies/window?postId=' + middle.target!.id)).data;
  assert.equal(wire.target.number, 5000); assert.equal(wire.items.length, 20); assert.deepEqual(wire.pinnedItems, []);
  const filteredWindow = await service.find('replies', root.id, { authorId: other.id }, viewer);
  assert.equal(filteredWindow.total, 4999);
  assert.equal(filteredWindow.maxNumber, 9999);
  const hiddenMax = await service.find('replies', root.id, {}, viewer);
  assert.equal(hiddenMax.total, 9999); assert.equal(hiddenMax.maxNumber, 9999);
  const created = await Promise.all(Array.from({ length: 4 }, (_, i) => request('/subthreads/' + sub.id + '/posts', 201, { content: '并发编号 ' + i, parentPostId: root.id, clientRequestId: randomUUID() })));
  assert.deepEqual(created.map(p => p.data.replyNumber).sort((a, b) => a - b), [10001, 10002, 10003, 10004]);
  const afterAppend = await service.find('replies', root.id, { cursor: middle.afterCursor! }, viewer);
  assert.deepEqual(afterAppend.items.map(p => p.id), next.items.map(p => p.id));
  await db.userBlock.create({ data: { blockerId: viewer, blockedId: other.id } });
  await request('/posts/' + root.id + '/replies/window?number=5000&authorId=' + viewer, 404);
  const blocked = await service.find('replies', root.id, {}, viewer);
  assert.equal(blocked.total, 5004); assert(blocked.items.every(p => p.authorId === viewer));
  await db.userBlock.deleteMany({ where: { blockerId: viewer, blockedId: other.id } });
  await db.post.createMany({ data: Array.from({ length: 10000 }, (_, i) => ({ threadId: thread.id, subthreadId: sub.id, authorId: viewer, floorNumber: i + 2, content: '主楼压力样本' })) });
  const first = await service.find('floors', sub.id, {}, viewer);
  assert.equal(first.items.length, 20); assert.equal(first.pinnedItems.length, 1);
  assert.equal(first.items[0].id, root.id); assert.equal((first.items[0] as any).replies.length, 5);
  queries = 0; const floorStart = performance.now();
  const floorEnd = await service.find('floors', sub.id, { number: 10000 }, viewer);
  metrics.push({ floors: 10001, milliseconds: Math.round((performance.now() - floorStart) * 100) / 100, sqlCounts: queries });
  assert.equal(floorEnd.target?.number, 10000); assert.equal(floorEnd.pinnedItems.length, 0); assert(queries <= 25);
  await request('/subthreads/' + sub.id + '/posts/window?number=10000');
  // 真实数据库竞态：读者已获得父范围后，在窗口的首个快照读取前删除父级。
  const raceQueries = new PostQueryService(prisma, access);
  const findRoot = raceQueries.findDiscussionRoot.bind(raceQueries);
  raceQueries.findDiscussionRoot = async (...args) => {
    await db.post.update({ where: { id: root.id }, data: { deletedAt: new Date() } });
    return findRoot(...args);
  };
  const raceService = new DiscussionWindowService(prisma, raceQueries, new ConfigService({ jwt: { accessSecret: process.env.JWT_ACCESS_SECRET } }));
  await assert.rejects(raceService.find('replies', root.id, { number: 1 }, viewer), (error: any) => error.getStatus() === 404);
  await db.post.update({ where: { id: root.id }, data: { deletedAt: null } });
  const findSub = raceQueries.findSubthreadContext.bind(raceQueries);
  raceQueries.findSubthreadContext = async (...args) => {
    await db.subthread.update({ where: { id: sub.id }, data: { deletedAt: new Date() } });
    return findSub(...args);
  };
  await assert.rejects(raceService.find('floors', sub.id, { number: 1 }, viewer), (error: any) => error.getStatus() === 404);
  await db.subthread.update({ where: { id: sub.id }, data: { deletedAt: null } });
  await db.thread.update({ where: { id: thread.id }, data: { visibility: 'PRIVATE' } });
  const anonymous = await fetch(process.env.API_BASE + '/posts/' + root.id + '/replies/window?number=1');
  assert.equal(anonymous.status, 404);
  await verifyIsolatedEnvironment();
  const evidence = { event: 'discussion-navigation-passed', runId: process.env.E2E_RUN_ID, migration: 'legacy-backfill-rerun-preserved', metrics };
  await writeFile('/tmp/discussion-navigation-metrics-' + process.env.E2E_RUN_ID + '.json', JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
}
main().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
