import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PostsService } from '../src/posts/posts.service';
import { DiceService } from '../src/dice/dice.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { AuditService } from '../src/moderation/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminPolicyService } from '../src/moderation/admin-policy.service';
import { ModerationProjectionService } from '../src/moderation/moderation-projection.service';
import { AdminModerationQueryService } from '../src/moderation/admin-moderation-query.service';

const MIGRATION = '20260929010000_post_edited_at';
const db = new PrismaClient({ log: [] });
type WirePost = { id: string; version: number; content: string; createdAt: string; editedAt: string | null; replies?: WirePost[] };

async function verifyMigration() {
  const database = 'wenyousite_edited_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL!); url.pathname = '/' + database;
  const legacy = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const root = await mkdtemp(join(dirname(process.env.E2E_MANIFEST!), 'edited-migration-'));
  let created = false;
  const deploy = (schema: string) => execFileSync(process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
    { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() }, stdio: 'pipe' });
  try {
    await db.$executeRawUnsafe(`CREATE DATABASE "${database}"`); created = true;
    await mkdir(join(root, 'migrations'));
    await cp('prisma/schema.prisma', join(root, 'schema.prisma'));
    for (const name of await readdir('prisma/migrations')) {
      if (name !== MIGRATION) await cp(join('prisma/migrations', name), join(root, 'migrations', name), { recursive: true });
    }
    deploy(join(root, 'schema.prisma'));
    const user = await legacy.user.create({ data: { username: 'legacy_' + randomUUID(), email: randomUUID() + '@edited.invalid', password: 'unused' } });
    const thread = await legacy.thread.create({ data: { title: '迁移样本', ownerId: user.id } });
    const sub = await legacy.subthread.create({ data: { threadId: thread.id, title: '子贴' } });
    const id = randomUUID(); const old = new Date('2026-01-01T00:00:00.000Z');
    await legacy.$executeRaw`INSERT INTO posts (id, thread_id, subthread_id, author_id, content, kind, floor_number, created_at, updated_at, lock_version)
      VALUES (${id}, ${thread.id}, ${sub.id}, ${user.id}, '历史正文', 'FLOOR', 1, ${old}, ${old}, 7)`;
    await cp(join('prisma/migrations', MIGRATION), join(root, 'migrations', MIGRATION), { recursive: true });
    deploy(join(root, 'schema.prisma'));
    const post = await legacy.post.findUniqueOrThrow({ where: { id } });
    assert.equal(post.editedAt, null); assert.equal(post.content, '历史正文'); assert.equal(post.version, 7);
    assert.equal(post.createdAt.toISOString(), old.toISOString()); assert.equal(post.updatedAt.toISOString(), old.toISOString());
    deploy(join(root, 'schema.prisma'));
    assert.equal((await legacy.post.findUniqueOrThrow({ where: { id } })).editedAt, null);
  } finally {
    await legacy.$disconnect();
    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await rm(root, { recursive: true });
  }
}

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.POST_EDITED_TIME_TEST_ENV, 'test');
  await verifyMigration();
  const viewer = process.env.E2E_USER_ID!;
  const sign = (id: string) => new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign({ sub: id }, { expiresIn: '15m' });
  const token = sign(viewer);
  async function request<T = WirePost>(path: string, method = 'GET', body?: unknown, auth = token, expected = 200): Promise<T> {
    await new Promise(resolve => setTimeout(resolve, 150));
    const response = await fetch(process.env.API_BASE + path, {
      method, headers: { authorization: 'Bearer ' + auth, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, expected, `${method} ${path} status`);
    return (await response.json() as { data: T }).data;
  }
  const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
  const thread = await db.thread.create({ data: { ownerId: viewer, title: '编辑时间隔离用例', category: category.slug, published: true, members: { create: { userId: viewer, role: 'OWNER' } } } });
  const sub = await db.subthread.create({ data: { threadId: thread.id, title: '子贴' } });
  await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
  const create = (content: string, parentPostId?: string) => request(`/subthreads/${sub.id}/posts`, 'POST', { content, ...(parentPostId ? { parentPostId } : {}) }, token, 201);
  const floor = await create('原楼层\n<br />');
  const reply = await create('原回复', floor.id);
  assert.equal(floor.editedAt, null); assert.equal(reply.editedAt, null);
  const noEdit = await request(`/posts/${floor.id}`, 'PATCH', { version: floor.version, content: '原楼层\r\n<br>' });
  assert.equal(noEdit.editedAt, null); assert.equal(noEdit.version, floor.version + 1);
  const first = await request(`/posts/${floor.id}`, 'PATCH', { version: noEdit.version, content: '首次编辑' });
  assert(first.editedAt && Date.parse(first.editedAt) > Date.parse(floor.createdAt));
  assert.equal(first.createdAt, floor.createdAt);
  const second = await request(`/posts/${floor.id}`, 'PATCH', { version: first.version, content: '再次编辑' });
  assert(second.editedAt && Date.parse(second.editedAt) > Date.parse(first.editedAt));
  const unchanged = await request(`/posts/${floor.id}`, 'PATCH', { version: second.version, content: '再次编辑' });
  assert.equal(unchanged.editedAt, second.editedAt);
  await request(`/posts/${floor.id}`, 'PATCH', { version: first.version, content: '冲突内容' }, token, 409);
  const other = await db.user.create({ data: { username: 'other_' + randomUUID(), email: randomUUID() + '@edited.invalid', password: 'unused' } });
  await request(`/posts/${floor.id}`, 'PATCH', { version: unchanged.version, content: '越权内容' }, sign(other.id), 403);
  assert.equal((await request(`/posts/${floor.id}`)).editedAt, second.editedAt);
  const editedReply = await request(`/posts/${reply.id}`, 'PATCH', { version: reply.version, content: '编辑后的回复' });
  assert(editedReply.editedAt);
  const floors = await request<WirePost[]>(`/subthreads/${sub.id}/posts`);
  assert.equal(floors.find(p => p.id === floor.id)?.editedAt, second.editedAt);
  assert.equal(floors.find(p => p.id === floor.id)?.replies?.[0].editedAt, editedReply.editedAt);
  const replies = await request<WirePost[]>(`/posts/${floor.id}/replies`);
  assert.equal(replies[0].editedAt, editedReply.editedAt);
  assert.equal((await request(`/posts/${reply.id}`)).editedAt, editedReply.editedAt);

  // 骰子表达式在正文 update 后被拒绝，验证真实事务回滚正文、版本和编辑时间。
  const node = randomUUID();
  const dice = await create(`骰子 [[dice:v1:${node}:1d20]]`);
  const beforeFailure = await db.post.findUniqueOrThrow({ where: { id: dice.id } });
  await request(`/posts/${dice.id}`, 'PATCH', { version: dice.version, content: `篡改 [[dice:v1:${node}:1d100]]` }, token, 400);
  assert.deepEqual(await db.post.findUniqueOrThrow({ where: { id: dice.id } }), beforeFailure);

  const prisma = db as unknown as PrismaService;
  // 模拟轻量读取之后另一编辑先提交，恶意/竞态的未来 version 也不能绕过正文比较基线。
  const concurrent = await create('并发之前');
  const concurrentAt = new Date();
  const racing = new PostsService(...([
    prisma, new EventEmitter2(), { assertAccessible: async () => {} },
    { lockContentInteraction: async () => {
      await db.post.update({ where: { id: concurrent.id }, data: { content: '并发已提交', version: { increment: 1 }, editedAt: concurrentAt } });
    } }, new DiceService(), {}, {}, {}, { assertContentAllowed: async () => [] }, {}, {}, { prepareMentions: async () => [] },
  ] as unknown as ConstructorParameters<typeof PostsService>));
  await assert.rejects(() => racing.update(concurrent.id, { version: concurrent.version + 1, content: '并发之前' }, viewer));
  const afterRace = await db.post.findUniqueOrThrow({ where: { id: concurrent.id } });
  assert.equal(afterRace.content, '并发已提交'); assert.equal(afterRace.version, concurrent.version + 1);
  assert.equal(afterRace.editedAt?.toISOString(), concurrentAt.toISOString());
  const moderation = new ModerationService(prisma, {} as AdminPolicyService, new AuditService(prisma),
    { finalizeContent: async () => {} } as unknown as ModerationProjectionService, {} as AdminModerationQueryService);
  const admin = await db.user.create({ data: { username: 'admin_' + randomUUID(), email: randomUUID() + '@edited.invalid', password: 'unused', role: 'ADMIN' } });
  const actor = { id: admin.id, username: admin.username, role: 'ADMIN' as const };
  for (const post of [dice, unchanged]) {
    const before = await db.post.findUniqueOrThrow({ where: { id: post.id } });
    await request(`/posts/${post.id}/pin`, 'POST', undefined, token, 201);
    await request(`/posts/${post.id}/pin`, 'DELETE');
    await moderation.hideContent(actor, 'POST', post.id, '隔离隐藏', {});
    await moderation.restoreContent(actor, 'POST', post.id, '隔离恢复', {});
    const restored = await db.post.findUniqueOrThrow({ where: { id: post.id } });
    assert.equal(restored.editedAt?.toISOString(), before.editedAt?.toISOString());
    assert.equal(restored.version, before.version); assert.equal(restored.content, before.content);
    await request(`/posts/${post.id}`, 'DELETE');
    assert.equal((await db.post.findUniqueOrThrow({ where: { id: post.id } })).editedAt?.toISOString(), before.editedAt?.toISOString());
  }

  const body = await request(`/subthreads/${sub.id}/body`, 'PUT', { content: '初始正文' });
  assert.equal(body.editedAt, null);
  const bodyEdited = await request(`/subthreads/${sub.id}/body`, 'PUT', { version: body.version, content: '新正文' });
  assert(bodyEdited.editedAt);
  const bodyNoChange = await request(`/subthreads/${sub.id}/body`, 'PUT', { version: bodyEdited.version, content: '新正文' });
  assert.equal(bodyNoChange.editedAt, bodyEdited.editedAt);
  async function aggregate(content: string) {
    const current = await db.thread.findUniqueOrThrow({ where: { id: thread.id } });
    const currentSub = await db.subthread.findUniqueOrThrow({ where: { id: sub.id } });
    const currentBody = await db.post.findUniqueOrThrow({ where: { id: body.id } });
    await request(`/threads/${thread.id}/aggregate`, 'PATCH', { version: current.version, defaultSubthreadVersion: currentSub.version, bodyVersion: currentBody.version, content, tagNames: [] });
    return db.post.findUniqueOrThrow({ where: { id: body.id } });
  }
  const aggregateEdited = await aggregate('聚合编辑正文'); assert(aggregateEdited.editedAt);
  assert(aggregateEdited.editedAt.toISOString() > bodyEdited.editedAt);
  const aggregateSame = await aggregate('聚合编辑正文');
  assert.equal(aggregateSame.editedAt?.toISOString(), aggregateEdited.editedAt.toISOString());
  assert.equal(aggregateSame.version, aggregateEdited.version);

  // 单独发布和聚合发布均只结算骰子，保留未编辑/已编辑的正文时间。
  for (const viaAggregate of [false, true]) {
    const draft = await db.thread.create({ data: { ownerId: viewer, title: '发布骰子', category: category.slug, members: { create: { userId: viewer, role: 'OWNER' } } } });
    const draftSub = await db.subthread.create({ data: { threadId: draft.id, title: '正文' } });
    const content = `待发布 [[dice:v1:${randomUUID()}:1d20]]`;
    const editedAt = viaAggregate ? new Date('2026-09-01T00:00:00Z') : null;
    const draftBody = await db.post.create({ data: { threadId: draft.id, subthreadId: draftSub.id, authorId: viewer, kind: 'BODY', content, editedAt } });
    await db.thread.update({ where: { id: draft.id }, data: { defaultSubthreadId: draftSub.id } });
    await request(`/threads/${draft.id}${viaAggregate ? '/aggregate' : ''}`, 'PATCH', { version: draft.version, published: true,
      ...(viaAggregate ? { defaultSubthreadVersion: draftSub.version, bodyVersion: draftBody.version, content, tagNames: [] } : {}) });
    const published = await db.post.findUniqueOrThrow({ where: { id: draftBody.id }, include: { diceRolls: true } });
    assert.equal(published.editedAt?.toISOString(), editedAt?.toISOString()); assert.equal(published.diceRolls.length, 1);
  }
  console.log('编辑时间：迁移、HTTP 读写、正文入口、事务回滚、管理恢复、发布结算通过');
}
void main().finally(() => db.$disconnect()).catch((error: unknown) => {
  // runner 将此输出存入本轮 0600 私有诊断文件。
  console.error(error); process.exitCode = 1;
});
