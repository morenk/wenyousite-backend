import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { withResources } from './e2e-resources';
import { AudioBudgetService, AUDIO_UPLOAD_LEASE_MS } from '../src/media/audio-budget.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MediaReferenceService } from '../src/media/media-reference.service';
import { MediaService } from '../src/media/media.service';
import { AudioRuntimeService } from '../src/media/audio-runtime.service';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { MediaProcessingService } from '../src/media/media-processing.service';
import { RedisService } from '../src/redis/redis.service';
import { Queue } from 'bullmq';
import { auditAudioResources } from './audio-resource-audit';

const code = (expected: number) => (error: unknown) => Boolean(error && typeof error === 'object' && 'errorCode' in error && error.errorCode === expected);
void withResources(async (runtime) => {
  const owner = new PrismaClient({ datasourceUrl: runtime.databaseUrl, log: [] });
  let db: PrismaClient | undefined;
  try {
    await runtime.verify();
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma/schema.prisma')], {
      cwd: runtime.root, env: { ...runtime.env, DATABASE_URL: runtime.databaseUrl, DIRECT_DATABASE_URL: runtime.databaseUrl }, stdio: 'pipe',
    });
    const password = randomBytes(24).toString('hex');
    await owner.$executeRawUnsafe(`CREATE ROLE wenyousite_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await owner.$executeRaw`GRANT USAGE ON SCHEMA public TO wenyousite_app`;
    await owner.$executeRaw`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO wenyousite_app`;
    await owner.$executeRaw`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO wenyousite_app`;
    const appUrl = new URL(runtime.databaseUrl); appUrl.username = 'wenyousite_app'; appUrl.password = password;
    db = new PrismaClient({ datasourceUrl: appUrl.toString(), log: [] });
    const prisma = db as unknown as PrismaService;
    const config = new ConfigService({ audio: { maxActiveUploads: 2, dailyInputBytes: 1000 } });
    const budget = new AudioBudgetService(prisma, config);
    async function user() { const id = randomUUID(); return db!.user.create({ data: { email: `${id}@audio.e2e.invalid`, username: id, password: 'unused' } }); }
    const input = (userId: string, size = 100) => ({ userId, key: randomUUID(), url: `https://audio.e2e.invalid/media/audio/${randomUUID()}.mp3`, stagingKey: randomUUID(), size, contentType: 'audio/wav' });
    const a = await user();
    const admissions = await Promise.allSettled(Array.from({ length: 8 }, () => budget.create(input(a.id), 100)));
    const accepted = admissions.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    assert.equal(accepted.length, 2); assert.equal(admissions.filter(r => r.status === 'rejected' && code(42901)(r.reason)).length, 6);
    assert.equal(await db.media.count({ where: { userId: a.id } }), 2);
    await Promise.all([budget.startProcessing(accepted[0].id, a.id, 100, 'audio/wav'), budget.startProcessing(accepted[1].id, a.id, 100, 'audio/wav')]);
    await assert.rejects(budget.create(input(a.id), 100), code(42901));
    await db.media.update({ where: { id: accepted[0].id }, data: { status: 'FAILED' } });
    await db.media.update({ where: { id: accepted[1].id }, data: { status: 'COMPLETED', size: 1 } });
    const replacement = await budget.create(input(a.id, 800), 800);
    await db.media.update({ where: { id: replacement.id }, data: { status: 'FAILED' } });
    await assert.rejects(budget.create(input(a.id, 1), 1), code(42902));
    assert.equal((await db.media.aggregate({ where: { userId: a.id }, _sum: { audioInputBytes: true } }))._sum.audioInputBytes, 1000);

    // 每日并发与 UTC 边界独立于活动槽：只允许一个请求使用最后的日额度。
    const b = await user(); const midnight = new Date('2030-01-02T00:00:00Z');
    const old = await budget.create(input(b.id, 600), 600, new Date(midnight.getTime() - 1));
    await db.media.update({ where: { id: old.id }, data: { status: 'COMPLETED' } });
    const today = await Promise.allSettled([budget.create(input(b.id, 600), 600, midnight), budget.create(input(b.id, 600), 600, midnight)]);
    assert.equal(today.filter(r => r.status === 'fulfilled').length, 1); assert.equal(today.filter(r => r.status === 'rejected' && code(42902)(r.reason)).length, 1);

    // 过期上传不占槽，但晚确认和重新签名必须竞争当前槽；同 ID 不增加输入累计。
    const c = await user(); const now = new Date(); const expiredAt = new Date(now.getTime() - AUDIO_UPLOAD_LEASE_MS - 1);
    const expired = await budget.create(input(c.id, 300), 300, expiredAt);
    const current = await Promise.all([budget.create(input(c.id), 100, now), budget.create(input(c.id), 100, now)]);
    await assert.rejects(budget.renew(expired.id, c.id, now), code(42901));
    await assert.rejects(budget.startProcessing(expired.id, c.id, 300, 'audio/wav', now), code(42901));
    await db.media.update({ where: { id: current[0].id }, data: { status: 'FAILED' } });
    await Promise.all([budget.renew(expired.id, c.id, now), budget.renew(expired.id, c.id, now)]);
    const confirmations = await Promise.all(Array.from({ length: 4 }, () => budget.startProcessing(expired.id, c.id, 300, 'audio/wav', now)));
    assert.equal(confirmations.filter(r => r.claimed).length, 1);
    assert.equal((await db.media.aggregate({ where: { userId: c.id }, _sum: { audioInputBytes: true } }))._sum.audioInputBytes, 500);
    await db.media.update({ where: { id: expired.id }, data: { processingStartedAt: new Date(0) } });
    await assert.rejects(budget.create(input(c.id), 100), code(42901), '长期PROCESSING不得按时间静默释放');

    // 历史 nullable 输入：只在仍是输入时补全，重签不新建记录；旧完成文件不追溯猜测。
    const d = await user(); const legacy = await db.media.create({ data: { ...input(d.id, 900), purpose: 'RICH_CONTENT_AUDIO', audioInputBytes: null, createdAt: new Date(now.getTime() - AUDIO_UPLOAD_LEASE_MS - 1) } });
    await assert.rejects(budget.create(input(d.id, 200), 200, now), code(42902));
    await budget.renew(legacy.id, d.id, now); assert.equal((await db.media.findUniqueOrThrow({ where: { id: legacy.id } })).audioInputBytes, 900);

    // 使用真实 MediaService 与真实回收领取SQL，存储/队列只用内存替身，不读写任何桶。
    const refs = new MediaReferenceService(prisma);
    let queued = 0; let failQueue = true;
    const storage = { bucket: 'isolated-no-store', publicUrl: (key: string) => 'https://audio.e2e.invalid/' + key,
      signUploadUrl: async () => 'https://audio.e2e.invalid/unused', head: async () => ({ ContentLength: 100, ContentType: 'audio/wav' }) };
    const processing = { cleanupCompletedStagingObjects: async () => 0 };
    const media = new MediaService(config, prisma, { hincrby: async () => 1, expire: async () => 1 } as unknown as RedisService,
      refs, storage as unknown as ObjectStorageService, processing as unknown as MediaProcessingService,
      { add: async () => { queued++; if (failQueue) throw new Error('SYNTHETIC_QUEUE_FAILURE'); } } as unknown as Queue,
      { requireReady: () => ({}) } as unknown as AudioRuntimeService, undefined, budget);
    const e = await user();
    const transport = await media.getUploadUrl({ userId: e.id, filename: 'synthetic.wav', contentType: 'audio/wav', purpose: 'RICH_CONTENT_AUDIO', size: 100 });
    await media.reissueUploadUrl(transport.mediaId, e.id);
    await assert.rejects(media.confirmUpload(transport.mediaId, e.id), /SYNTHETIC_QUEUE_FAILURE/);
    assert.equal((await db.media.findUniqueOrThrow({ where: { id: transport.mediaId } })).status, 'UPLOADING');
    failQueue = false;
    await media.confirmUpload(transport.mediaId, e.id); await media.confirmUpload(transport.mediaId, e.id);
    assert.equal(queued, 2); assert.equal((await db.media.findUniqueOrThrow({ where: { id: transport.mediaId } })).audioInputBytes, 100);

    const f = await user(); const ancient = new Date(now.getTime() - 2 * 86400000);
    const renewed = await budget.create(input(f.id), 100, ancient);
    await media.reissueUploadUrl(renewed.id, f.id);
    let eligibility: Parameters<MediaReferenceService['claimUnreferenced']>[1] | undefined;
    const originalClaim = refs.claimUnreferenced.bind(refs);
    refs.claimUnreferenced = async (_ids, where) => { eligibility = where; return []; };
    await media.cleanupOrphanMedia(); refs.claimUnreferenced = originalClaim;
    // 当没有其他候选时创建一个真正过期项，确保捕捉的谓词来自生产服务。
    const victim = await budget.create(input(f.id), 100, ancient);
    refs.claimUnreferenced = async (_ids, where) => { eligibility = where; return []; };
    await media.cleanupOrphanMedia(); refs.claimUnreferenced = originalClaim;
    assert(eligibility);
    assert.deepEqual(await refs.claimUnreferenced([renewed.id], eligibility), [], '已续租旧上传不得被24h回收');
    assert.equal((await refs.claimUnreferenced([victim.id], eligibility)).length, 1);
    await assert.rejects(budget.renew(victim.id, f.id)); await assert.rejects(budget.startProcessing(victim.id, f.id, 100, 'audio/wav'));
    // 锁竞争：预算先持有用户行锁，回收可先领取媒体；预算醒来必须拒绝。
    const raceUser = await user(); const race = await budget.create(input(raceUser.id), 100, ancient);
    let release!: () => void; let locked!: () => void;
    const ready = new Promise<void>(ok => { locked = ok; }); const finish = new Promise<void>(ok => { release = ok; });
    const hold = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM users WHERE id=${raceUser.id} FOR NO KEY UPDATE`; locked(); await finish; });
    await ready; const renew = budget.renew(race.id, raceUser.id); const rejected = assert.rejects(renew);
    try { assert.equal((await refs.claimUnreferenced([race.id], eligibility)).length, 1); } finally { release(); }
    await hold; await rejected;
    // 相反锁序结果：续租或晚确认先完成，等待中的回收必须在行锁后重查并放弃。
    for (const operation of ['renew', 'confirm'] as const) {
      const actor = await user(); const item = await budget.create(input(actor.id), 100, ancient);
      let commit!: () => void; let admitted!: () => void;
      const hasAdmission = new Promise<void>(ok => { admitted = ok; }); const mayCommit = new Promise<void>(ok => { commit = ok; });
      const pausing = { $transaction: (run: Parameters<PrismaClient['$transaction']>[0]) => db!.$transaction(async tx => {
        const result = await (run as (client: typeof tx) => Promise<unknown>)(tx); admitted(); await mayCommit; return result;
      }) };
      const concurrent = new AudioBudgetService(pausing as unknown as PrismaService, config);
      const admission = operation === 'renew' ? concurrent.renew(item.id, actor.id) : concurrent.startProcessing(item.id, actor.id, 100, 'audio/wav');
      await hasAdmission;
      let finished = false;
      const reclaim = refs.claimUnreferenced([item.id], eligibility).finally(() => { finished = true; });
      try { await new Promise(ok => setTimeout(ok, 50)); assert.equal(finished, false); } finally { commit(); }
      await admission; assert.deepEqual(await reclaim, []);
    }
    const before = await db.media.count();
    const audit = await auditAudioResources(db, false);
    assert.equal(audit.readOnly, true); assert.equal(audit.budgetSchema, true); assert.equal(await db.media.count(), before);
    assert(Number(audit.summary.processing_stale) >= 1); assert(Number(audit.summary.deletion_claimed) >= 2);
    assert(!JSON.stringify(audit).includes(raceUser.id)); assert(!JSON.stringify(audit).includes('https://'));
    console.log(JSON.stringify({ event: 'audio-budget-passed', runId: runtime.runId, cases: ['atomic-active','atomic-daily','utc-boundary','immutable-input','lease-expiry','late-confirm','same-id-retry','nullable-legacy','queue-failure-recovery','cleanup-claim-race','renew-confirm-win-race','readonly-audit'], storage: 'in-memory-no-network' }));
  } finally { await db?.$disconnect(); await owner.$disconnect(); }
}).catch((error: unknown) => { console.error(JSON.stringify({ event: 'audio-budget-failed', category: error instanceof Error ? error.name : 'unknown' })); process.exitCode = 1; });
