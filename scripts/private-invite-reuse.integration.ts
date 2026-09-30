import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ThreadInviteService } from '../src/threads/thread-invite.service';
import { ThreadAccessService } from '../src/access/thread-access.service';
import { PrismaService } from '../src/prisma/prisma.service';

const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let nativeUpserts = 0;
db.$on('query', event => {
  // 只统计 SQL 形态，不记录 query 参数或邀请凭据。
  if (event.query.includes('INSERT INTO "public"."thread_invites"') && event.query.includes('ON CONFLICT')) nativeUpserts++;
});

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.PRIVATE_INVITE_REUSE_TEST_ENV, 'test');
  const createUser = () => db.user.create({ data: {
    username: 'invite_' + randomUUID().slice(0, 12), email: randomUUID() + '@invite.invalid', password: 'unused',
  } });
  const owner = await createUser(); const member = await createUser(); const newcomer = await createUser();
  const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
  const makeThread = (visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE', published = true, deletedAt: Date | null = null) =>
    db.thread.create({ data: { ownerId: owner.id, title: '邀请复用隔离样本', category: category.slug, visibility,
      published, publishedAt: published ? new Date() : null, deletedAt,
      members: { create: { userId: owner.id, role: 'OWNER', playerMarked: true } } } });
  const thread = await makeThread();
  const prisma = db as unknown as PrismaService;
  const service = new ThreadInviteService(prisma, new ThreadAccessService(prisma));
  const concurrent = await Promise.all(Array.from({ length: 16 }, () => service.ensure(thread.id, owner.id)));
  assert.equal(nativeUpserts, 16, '必须使用数据库原生 upsert，避免空 update 的先查后建竞态');
  assert.equal(new Set(concurrent.map(invite => invite.token)).size, 1, '并发首次复制必须返回同一 token');
  assert.equal(await db.threadInvite.count({ where: { threadId: thread.id } }), 1);
  const initial = concurrent[0];
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const request = async <T>(path: string, userId?: string, method = 'GET', status = 200): Promise<T> => {
    await new Promise(resolve => setTimeout(resolve, 150));
    const response = await fetch(process.env.API_BASE + path, {
      method, headers: userId ? { authorization: 'Bearer ' + jwt.sign({ sub: userId, jti: randomUUID() }, { expiresIn: '5m' }) } : {},
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, status, method + ' 邀请链路状态码不符');
    return (await response.json() as { data: T }).data;
  };
  type Invite = { id: string; threadId: string; token: string; createdAt: string };
  const fresh = await makeThread();
  const freshEndpoint = '/threads/' + fresh.id + '/invite-link';
  const created = await request<Invite>(freshEndpoint, owner.id, 'PUT');
  assert.equal(created.threadId, fresh.id);
  assert.equal(created.token.length, 16);
  assert.equal((await request<Invite>(freshEndpoint, owner.id, 'PUT')).token === created.token, true,
    'HTTP 首次创建和再次复制必须都返回 200 且复用 token');
  await request('/threads/' + randomUUID() + '/invite-link', owner.id, 'PUT', 404);
  const endpoint = '/threads/' + thread.id + '/invite-link';
  const first = await request<Invite>(endpoint, owner.id, 'PUT');
  const second = await request<Invite>(endpoint, owner.id, 'PUT');
  assert.equal(first.token === initial.token && second.token === initial.token, true, '重新登录或再次复制不能重置');
  assert.equal(first.id, second.id); assert.equal(first.createdAt, second.createdAt);
  await request(endpoint, undefined, 'PUT', 401);
  await request(endpoint, newcomer.id, 'PUT', 404);
  const join = (token: string) => '/threads/join-by-link/' + token;
  await request(join(initial.token), member.id, 'POST', 201);
  await request(endpoint, member.id, 'PUT', 404);
  const membersBefore = await db.threadMember.findMany({ where: { threadId: thread.id }, orderBy: { id: 'asc' } });
  const reset = await request<Invite>(endpoint, owner.id, 'POST', 201);
  assert.equal(reset.token !== initial.token, true, '显式重置必须更换 token');
  for (const user of [owner, member, newcomer]) {
    await request(join(initial.token), user.id, 'GET', 404);
    await request(join(initial.token), user.id, 'POST', 404);
  }
  const recovered = await request<Invite>(endpoint, owner.id, 'PUT');
  assert.equal(recovered.token === reset.token, true, '重置响应丢失后 PUT 取回当前链接而非再次重置');
  await request('/threads/' + thread.id, member.id);
  assert.deepEqual(await db.threadMember.findMany({ where: { threadId: thread.id }, orderBy: { id: 'asc' } }), membersBefore,
    '重置不修改任何既有成员记录');
  const preview = await request<{ alreadyJoined: boolean }>(join(reset.token), member.id);
  assert.equal(preview.alreadyJoined, true);
  await request(join(reset.token), newcomer.id);
  await request(join(reset.token), newcomer.id, 'POST', 201);
  await request('/threads/' + thread.id, newcomer.id);

  const [draft, publicThread, deleted] = await Promise.all([
    makeThread('PRIVATE', false), makeThread('PUBLIC'), makeThread('PRIVATE', true, new Date()),
  ]);
  for (const [target, status] of [[draft, 403], [publicThread, 403], [deleted, 404]] as const) {
    for (const method of ['PUT', 'POST']) await request('/threads/' + target.id + '/invite-link', owner.id, method, status);
    assert.equal(await db.threadInvite.count({ where: { threadId: target.id } }), 0);
  }
  await request('/threads/' + publicThread.id + '/invite-link', newcomer.id, 'PUT', 403);

  // 多轮让首次创建/复用与重置争用同一唯一键；重置的 token 不得被迟到的 ensure 覆盖。
  for (let round = 0; round < 8; round++) {
    const contested = await makeThread();
    const [replacement] = await Promise.all([
      service.create(contested.id, owner.id),
      ...Array.from({ length: 8 }, () => service.ensure(contested.id, owner.id)),
    ]);
    const latest = await service.ensure(contested.id, owner.id);
    assert.equal(latest.token === replacement.token, true, '并发复用不能覆盖已重置 token');
    assert.equal(await db.threadInvite.count({ where: { threadId: contested.id } }), 1);
  }
  console.log('通过：原生并发首次取得、重复/跨会话复用、重置恢复、旧链接统一失效、成员访问保留及全部拒绝路径');
}
void main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : '私帖邀请隔离回归失败（内部上下文已隐藏）');
  process.exitCode = 1;
}).finally(async () => { await db.$disconnect(); });
