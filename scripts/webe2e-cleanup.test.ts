import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { apply, canonical, digest, dryRun, invalidate, TARGET } from './webe2e-cleanup';

function fixture() {
  const state: Record<string, any[]> = {
    user: [{ ...TARGET }], thread: [{ id: 't1', ownerId: TARGET.id, title: 'private title', deletedAt: null, published: false }],
    post: [{ id: 'p1', threadId: 't1', authorId: TARGET.id, content: 'private body\r\n正文' }],
    postMedia: [{ id: 'pm1', postId: 'p1', mediaId: 'shared' }, { id: 'pm2', postId: 'p1', mediaId: 'orphan' }],
    media: [{ id: 'shared', orphanedAt: null }, { id: 'orphan', orphanedAt: null }],
    wallet: [{ id: 'w1', balance: 0n }], auditLog: [],
  };
  let transactionCount = 0;
  let failReceipt = false;
  const counts: Record<string, number> = {};
  const tx: any = new Proxy({}, { get: (_, model: string) => {
    if (model === '$queryRaw') return async () => [{ database: 'isolated', oid: 1, address: '127.0.0.1', port: 40000 }];
    if (model === '$executeRaw') return async () => 0;
    return {
      findUnique: async ({ where }: any) => (state[model] ?? []).find((r) => !where.id || r.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => state[model].find((r) => r.id === where.id),
      findMany: async () => model === 'media' ? [{ id: 'shared' }] : state[model] ?? [],
      count: async () => model === 'thread' ? state.thread.length : counts[model] ?? 0,
      deleteMany: async () => { const count = state[model].length; state[model] = []; return { count }; },
      create: async ({ data }: any) => { if (failReceipt) throw new Error('receipt failure'); state[model].push(data); return data; },
      update: async ({ where, data }: any) => Object.assign(state[model].find((r) => r.id === where.id), data),
      updateMany: async ({ where, data }: any) => { for (const row of state[model]) if (where.id.in.includes(row.id)) Object.assign(row, data); },
    };
  } });
  const prisma = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async (fn: any) => {
    transactionCount++;
    const before = structuredClone(state);
    try { return await fn(tx); } catch (error) { Object.assign(state, before); throw error; }
  } : target[key] }) as PrismaClient;
  return { state, counts, prisma, fail: () => { failReceipt = true; }, transactions: () => transactionCount };
}

test('manifest 不包含明文内容，键序不影响校验值', async () => {
  const f = fixture(); const manifest = await dryRun(f.prisma);
  assert(!canonical(manifest).includes('private body'));
  assert(!canonical(manifest).includes('private title'));
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.equal(manifest.resources.posts[0].normalizedContentSha256, digest('private body\n正文'));
});
for (const [name, mutate] of [
  ['错误身份', (f: ReturnType<typeof fixture>) => { f.state.user[0].username = 'different'; }],
  ['其他用户正文', (f: ReturnType<typeof fixture>) => { f.state.post[0].authorId = 'other'; }],
  ['其他用户收藏', (f: ReturnType<typeof fixture>) => { f.state.userBookmark = [{ id: 'b', userId: 'other' }]; }],
  ['交易', (f: ReturnType<typeof fixture>) => { f.counts.walletTransaction = 1; }],
  ['外部回复', (f: ReturnType<typeof fixture>) => { f.counts.post = 1; }],
  ['独立草稿', (f: ReturnType<typeof fixture>) => { f.state.draft = [{ id: 'd' }]; }],
  ['待处理事件', (f: ReturnType<typeof fixture>) => { f.counts.domainOutbox = 1; }],
] as const) test(`${name} 导致拒绝`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(dryRun(f.prisma));
  assert.equal(f.state.thread.length, 1);
});
test('校验失败在事务之前拒绝，内容漂移在事务内拒绝', async () => {
  const f = fixture(); const manifest = await dryRun(f.prisma); const sha = digest(manifest);
  await assert.rejects(apply(f.prisma, manifest, '0'.repeat(64), '1'.repeat(64)));
  assert.equal(f.transactions(), 1);
  f.state.post[0].content = 'changed';
  await assert.rejects(apply(f.prisma, manifest, sha, '1'.repeat(64)), /漂移/);
  assert.equal(f.state.thread.length, 1);
});
test('事务后段故障回滚删除；账号钱包保留', async () => {
  const f = fixture(); const manifest = await dryRun(f.prisma); f.fail();
  await assert.rejects(apply(f.prisma, manifest, digest(manifest), '1'.repeat(64)), /receipt failure/);
  assert.equal(f.state.thread.length, 1);
  assert.equal(f.state.auditLog.length, 0);
  assert.equal(f.state.wallet[0].balance, 0n);
});
test('共享媒体保留，无引用媒体标记回收；重复 apply 不再删除', async () => {
  const f = fixture(); const manifest = await dryRun(f.prisma); const sha = digest(manifest);
  assert.deepEqual(await apply(f.prisma, manifest, sha, '1'.repeat(64)), { alreadyApplied: false });
  assert.equal(f.state.media[0].orphanedAt, null);
  assert(f.state.media[1].orphanedAt instanceof Date);
  assert.equal(f.state.user[0].id, TARGET.id);
  assert.deepEqual(await apply(f.prisma, manifest, sha, '1'.repeat(64)), { alreadyApplied: true });
  assert.equal(f.state.auditLog.length, 1);
});
test('缓存失败保留 pending，重试只定向失效且记录完成', async () => {
  const f = fixture(); const manifest = await dryRun(f.prisma); const sha = digest(manifest);
  await apply(f.prisma, manifest, sha, '1'.repeat(64));
  let fail = true;
  const keys: string[] = [];
  const batch = { del: (key: string) => { keys.push(key); return batch; }, zrem: (key: string) => { keys.push(key); return batch; }, exec: async () => fail ? [[new Error('offline'), null]] : [[null, 1]] };
  const redis = { multi: () => batch } as unknown as Redis;
  await assert.rejects(invalidate(f.prisma, redis, manifest, sha));
  assert.equal(f.state.auditLog[0].metadata.cacheInvalidation, 'pending');
  fail = false;
  await invalidate(f.prisma, redis, manifest, sha);
  assert.equal(f.state.auditLog[0].metadata.cacheInvalidation, 'complete');
  assert(keys.every((k) => k.startsWith('threads:by:') || k === 'thread:t1:stats'));
});

test('三笔无关账务纳入 preserved 且原样保留，账务漂移拒绝', async () => {
  const f = fixture();
  f.state.walletTransaction = [1, 2, 3].map((id) => ({ id: `tx${id}`, grossAmount: 100n, targetUserId: TARGET.id }));
  const before = structuredClone(f.state.walletTransaction);
  const manifest = await dryRun(f.prisma);
  assert.equal(manifest.counts.transactions, 0);
  assert.equal(manifest.preserved.transactions.length, 3);
  f.state.walletTransaction[0].grossAmount = 200n;
  await assert.rejects(apply(f.prisma, manifest, digest(manifest), '1'.repeat(64)), /漂移/);
  f.state.walletTransaction = structuredClone(before);
  await apply(f.prisma, manifest, digest(manifest), '1'.repeat(64));
  assert.deepEqual(f.state.walletTransaction, before);
});
