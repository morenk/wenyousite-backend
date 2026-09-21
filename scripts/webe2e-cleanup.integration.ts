import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { withResources } from './e2e-resources';
import { apply, digest, dryRun, invalidate, snapshot, TARGET } from './webe2e-cleanup';

void withResources(async (runtime) => {
  const db = new PrismaClient({ datasourceUrl: runtime.databaseUrl });
  const redis = new Redis({ host: '127.0.0.1', port: runtime.redisPort, password: runtime.redisPassword });
  try {
    await runtime.verify();
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma/schema.prisma')], {
      cwd: runtime.root, env: { ...runtime.env, DATABASE_URL: runtime.databaseUrl, DIRECT_DATABASE_URL: runtime.databaseUrl }, stdio: 'pipe',
    });
    await db.user.create({ data: { ...TARGET, email: 'cleanup@e2e.invalid', password: 'unused' } });
    const peer = await db.user.create({ data: { username: 'peer', email: 'peer@e2e.invalid', password: 'unused' } });
    const wallet = await db.wallet.create({ data: { userId: TARGET.id, kind: 'USER' } });
    const peerWallet = await db.wallet.create({ data: { userId: peer.id, kind: 'USER' } });
    const platform = await db.wallet.findFirstOrThrow({ where: { kind: 'PLATFORM' } });
    const tipData = () => ({
      type: 'TIP' as const, targetType: 'USER' as const, targetUserId: TARGET.id,
      senderWalletId: peerWallet.id, recipientWalletId: wallet.id, platformWalletId: platform.id,
      grossAmount: 100n, recipientAmount: 100n, recipientBalanceAfter: 100n,
      senderBalanceAfter: 0n, platformBalanceAfter: 0n, clientRequestId: randomUUID(), requestHash: 'fixture',
    });
    const ledger = await Promise.all([1, 2].map(() => db.walletTransaction.create({ data: tipData() })));
    const accountBefore = await db.user.findUniqueOrThrow({ where: { id: TARGET.id } });
    const walletBefore = await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const walletCount = await db.wallet.count();
    const thread = await db.thread.create({ data: { ownerId: TARGET.id, title: '私有测试标题' } });
    const sub = await db.subthread.create({ data: { threadId: thread.id, title: '测试子贴' } });
    const post = await db.post.create({ data: { threadId: thread.id, subthreadId: sub.id, authorId: TARGET.id, content: '私有测试正文', kind: 'BODY' } });
    const media = await Promise.all(['shared', 'orphan'].map((key) => db.media.create({ data: {
      userId: TARGET.id, key, url: `https://example.invalid/${key}`, status: 'COMPLETED', purpose: 'RICH_CONTENT',
    } })));
    await db.postMedia.createMany({ data: media.map((m, sortOrder) => ({ mediaId: m.id, postId: post.id, sortOrder })) });
    const peerDraft = await db.draft.create({ data: { userId: peer.id, content: 'peer' } });
    await db.draftMedia.create({ data: { draftId: peerDraft.id, mediaId: media[0].id, sortOrder: 0 } });
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.walletTransaction.create({ data: {
        ...tipData(), targetType: 'THREAD', targetThreadId: thread.id, threadTipTotalAfter: 100n,
      } });
      await assert.rejects(snapshot(tx), /目标内容存在交易引用/);
      throw new Error('rollback fixture transaction');
    }), /rollback fixture transaction/);
    const beforeNewLedger = await dryRun(db);
    ledger.push(await db.walletTransaction.create({ data: tipData() }));
    await assert.rejects(apply(db, beforeNewLedger, digest(beforeNewLedger), '1'.repeat(64)), /漂移/);
    const original = await dryRun(db);
    assert.equal(original.counts.transactions, 0);
    assert.equal(original.preserved.transactions.length, 3);
    const originalSha = digest(original);
    await db.post.update({ where: { id: post.id }, data: { content: 'changed' } });
    await assert.rejects(apply(db, original, originalSha, '1'.repeat(64)), /漂移/);
    await db.post.update({ where: { id: post.id }, data: { authorId: peer.id } });
    await assert.rejects(dryRun(db), /其他用户/);
    await db.post.update({ where: { id: post.id }, data: { authorId: TARGET.id } });
    const manifest = await dryRun(db); const sha = digest(manifest);
    // 即便数据库触发器意外修改保留钱包，删除后复核也必须回滚整个事务。
    await db.$executeRawUnsafe("CREATE FUNCTION mutate_preserved_wallet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE wallets SET balance = balance + 1 WHERE user_id = OLD.owner_id; RETURN OLD; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER mutate_preserved_wallet AFTER DELETE ON threads FOR EACH ROW EXECUTE FUNCTION mutate_preserved_wallet()');
    await assert.rejects(apply(db, manifest, sha, '1'.repeat(64)), /保留账号、钱包或账务发生变化/);
    assert.equal(await db.thread.count(), 1);
    assert.deepEqual(await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } }), walletBefore);
    await db.$executeRawUnsafe('DROP TRIGGER mutate_preserved_wallet ON threads');
    await db.$executeRawUnsafe('DROP FUNCTION mutate_preserved_wallet()');
    // 后段审计写入故障必须回滚真正的 FK 级联删除及媒体标记。
    await db.$executeRawUnsafe("CREATE FUNCTION reject_cleanup_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected cleanup test failure'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER reject_cleanup_receipt BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_cleanup_receipt()');
    await assert.rejects(apply(db, manifest, sha, '1'.repeat(64)));
    assert.equal(await db.post.count(), 1);
    assert.equal(await db.postMedia.count(), 2);
    await db.$executeRawUnsafe('DROP TRIGGER reject_cleanup_receipt ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION reject_cleanup_receipt()');
    // 并发修改已经持有行锁时，apply 必须等待并在获得表锁后发现漂移。
    let unlock!: () => void; let locked!: () => void;
    const lockedPromise = new Promise<void>((ok) => { locked = ok; });
    const unlockPromise = new Promise<void>((ok) => { unlock = ok; });
    const edit = db.$transaction(async (tx) => {
      await tx.post.update({ where: { id: post.id }, data: { content: 'concurrent' } });
      locked(); await unlockPromise;
    });
    await lockedPromise;
    const deletion = apply(db, manifest, sha, '1'.repeat(64));
    const rejected = assert.rejects(deletion, /漂移/);
    unlock(); await edit; await rejected;
    const finalManifest = await dryRun(db); const finalSha = digest(finalManifest);
    assert.deepEqual(await apply(db, finalManifest, finalSha, '1'.repeat(64)), { alreadyApplied: false });
    assert.equal(await db.thread.count(), 0); assert.equal(await db.post.count(), 0);
    assert.equal(await db.postMedia.count(), 0); assert.equal(await db.draftMedia.count(), 1);
    assert.equal((await db.media.findUniqueOrThrow({ where: { id: media[0].id } })).orphanedAt, null);
    assert((await db.media.findUniqueOrThrow({ where: { id: media[1].id } })).orphanedAt);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: TARGET.id } }), accountBefore);
    assert.deepEqual(await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } }), walletBefore);
    const afterLedger = await db.walletTransaction.findMany({ orderBy: { id: 'asc' } });
    assert.deepEqual(afterLedger, [...ledger].sort((a, b) => a.id.localeCompare(b.id)));
    assert.equal(await db.user.count(), 2); assert.equal(await db.wallet.count(), walletCount);
    await redis.set(`thread:${thread.id}:stats`, 'wrong-type-cache');
    await redis.set('unrelated:sentinel', 'keep');
    await redis.set('threads:by:created', 'wrong-type');
    await assert.rejects(invalidate(db, redis, finalManifest, finalSha), /缓存/);
    await redis.del('threads:by:created');
    assert.deepEqual(await apply(db, finalManifest, finalSha, '1'.repeat(64)), { alreadyApplied: true });
    await invalidate(db, redis, finalManifest, finalSha);
    assert.equal(await redis.get('unrelated:sentinel'), 'keep');
    assert.equal(((await db.auditLog.findFirstOrThrow()).metadata as Record<string, unknown>)?.['cacheInvalidation'], 'complete');
    console.log('清理集成通过：独立 PostgreSQL/Redis、范围漂移、真实事务回滚、并发、共享媒体、缓存失败重试及重复执行');
  } finally { redis.disconnect(); await db.$disconnect(); }
}).catch((error) => { require('node:fs').writeFileSync('/tmp/webe2e-cleanup-integration-error.log', error instanceof Error ? error.stack ?? error.message : String(error), { mode: 0o600 }); console.error('清理隔离集成失败（连接信息与正文已隐藏）'); process.exitCode = 1; });
