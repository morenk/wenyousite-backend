import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
import { processStart } from './e2e-processes';
import { FontProcessingService } from '../src/text-fonts/font-processing.service';
import { FontQueueListener } from '../src/text-fonts/font-queue.listener';
import { FontStorageService } from '../src/text-fonts/font-storage.service';
import { FontSandboxService } from '../src/text-fonts/font-sandbox.service';
import { FontWorkDirectoryService } from '../src/text-fonts/font-work-directory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/moderation/audit.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { lockFontState } from '../src/text-fonts/font-domain';

type Request = (path: string, method?: string, body?: unknown, status?: number) => Promise<Record<string, any>>;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyFontLease(db: PrismaClient, request: Request, configuration: Record<string, unknown>, source: Buffer) {
  await verifyIsolatedEnvironment();
  const manifest = assertIsolatedEnvironment();
  const queue = new Queue('text-font', { connection: {
    host: '127.0.0.1', port: manifest.redis.port, password: process.env.REDIS_PASSWORD, db: 0,
  } });
  let release!: () => void, started!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const verifying = new Promise<void>(resolve => { started = resolve; });
  const prisma = db as PrismaService;
  // 复用本轮真实沙箱已产生的 artifact，仅暂停存储复验，观察真实数据库租约与恢复器。
  const storage = { verifyAssets: async () => { started(); await delayed; } } as unknown as FontStorageService;
  const work = { abandoned: async () => [] } as unknown as FontWorkDirectoryService;
  const service = new FontProcessingService(prisma, storage, {} as FontSandboxService, new AuditService(prisma), work);
  let processing: Promise<void> | undefined;
  try {
    await queue.pause();
    const family = await request('/admin/text-fonts', 'POST', configuration, 201);
    const draft = await request(`/admin/text-fonts/${family.familyId}/sources?format=ttf&expectedFamilyRevision=${family.revision}`, 'POST', source, 201);
    await request(`/admin/text-fonts/jobs/${draft.jobId}/process`, 'POST', undefined, 201);
    const job = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: draft.jobId } });
    assert(await db.textFontArtifact.findUnique({ where: { buildKey: job.buildKey! } }), '租约测试必须复用本轮真实构建');
    processing = service.process(job.id, job.attempt);
    await Promise.race([verifying, processing.then(() => { throw new Error('未进入存储复验'); })]);
    const claimed = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: job.id } });
    const shortenedExpiry = new Date(Date.now() + 45000);
    await db.$transaction(async tx => {
      await lockFontState(tx);
      await tx.textFontBuildJob.update({ where: { id: job.id }, data: { leaseExpiresAt: shortenedExpiry } });
    });
    let renewed = false;
    for (const deadline = Date.now() + 40000; Date.now() < deadline;) {
      const current = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(current.claimToken, claimed.claimToken);
      assert.equal(current.attempt, job.attempt);
      if (current.leaseExpiresAt!.getTime() > Date.now() + 600000) { renewed = true; break; }
      await pause(200);
    }
    assert(renewed, '慢速存储期间未续租');
    await pause(Math.max(0, shortenedExpiry.getTime() - Date.now() + 100));
    await new FontQueueListener(queue, prisma, new OutboxService(), work).recoverExpired();
    const current = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(current.status, 'PROCESSING');
    assert.equal(current.claimToken, claimed.claimToken, '恢复器不能抢占仍有有效租约的任务');
    assert.equal(current.attempt, job.attempt);
    release();
    await processing;
    const completed = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(completed.status, 'READY');
    assert.equal(completed.leaseExpiresAt, null);
    assert.equal(await db.textFontVersion.count({ where: { familyId: family.familyId } }), 1);
  } finally {
    release();
    await processing?.catch(() => {});
    await queue.resume();
    await queue.close();
  }
}

export async function verifyFontWorkerRecovery(db: PrismaClient, request: Request, configuration: Record<string, unknown>, sources: Buffer[]) {
  await verifyIsolatedEnvironment();
  const manifest = assertIsolatedEnvironment();
  assert.equal(manifest.textFonts?.workers.length, 2, '真实双 Worker 验证需要 runner 登记两个独立进程');
  const workers = manifest.textFonts!.workers;
  const queue = new Queue('text-font', { connection: {
    host: '127.0.0.1', port: manifest.redis.port, password: process.env.REDIS_PASSWORD, db: 0,
  } });
  try {
    assert.equal(await queue.getGlobalConcurrency(), 1);
    await queue.pause();
    const family = await request('/admin/text-fonts', 'POST', { ...configuration, name: `故障验证 ${randomUUID()}` }, 201);
    const jobs: string[] = [];
    for (const source of sources) {
      const job = await request(`/admin/text-fonts/${family.familyId}/sources?format=ttf&expectedFamilyRevision=${family.revision}`, 'POST', source, 201);
      await request(`/admin/text-fonts/jobs/${job.jobId}/process`, 'POST', undefined, 201);
      jobs.push(job.jobId);
    }
    for (let attempt = 0; (await queue.getJobCounts('paused')).paused < jobs.length; attempt++) {
      assert(attempt < 300, 'Outbox 未投递暂停队列');
      await pause(100);
    }
    await queue.resume();
    const workRoot = join(manifest.textFonts!.storagePath, 'work');
    let killedRoot = '', killedJob = '';
    for (let attempt = 0; !killedRoot && attempt < 1000; attempt++) {
      for (const name of existsSync(workRoot) ? readdirSync(workRoot) : []) {
        const root = join(workRoot, name), path = join(root, 'ownership.json');
        if (!existsSync(path)) continue;
        let owner: { jobId: string; pid: number; processStart: string; uid: number; device: number; inode: number; kind: string };
        try { owner = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
        if (owner.kind !== 'build' || !jobs.includes(owner.jobId)) continue;
        const registered = workers.find(worker => worker.pid === owner.pid && worker.start === owner.processStart);
        assert(registered && processStart(owner.pid) === registered.start, '拒绝终止未登记或 PID 复用的进程');
        const stat = lstatSync(root);
        assert(stat.uid === process.getuid?.() && stat.dev === owner.device && stat.ino === owner.inode);
        killedRoot = root; killedJob = owner.jobId;
        process.kill(owner.pid, 'SIGKILL');
        break;
      }
      if (!killedRoot) await pause(10);
    }
    assert(killedRoot, '未观察到真实 Worker 工作目录，未执行中断验收');
    const deadline = Date.now() + 240000;
    let complete = false;
    while (Date.now() < deadline) {
      assert((await queue.getActiveCount()) <= 1, '双 Worker 违反全局单并发');
      const states = await db.textFontBuildJob.findMany({ where: { id: { in: jobs } } });
      assert(states.filter(job => job.status === 'PROCESSING').length <= 1, '持久任务同时处理超过一项');
      assert(!states.some(job => job.status === 'FAILED'), '中断恢复后任务失败');
      if (states.every(job => job.status === 'READY')) {
        assert(states.find(job => job.id === killedJob)!.attempt > 1, '崩溃任务未通过新尝试恢复');
        assert.equal(new Set(states.map(job => job.versionId)).size, sources.length);
        complete = true; break;
      }
      await pause(250);
    }
    assert(complete, 'Worker SIGKILL 后未恢复完成');
    assert(!existsSync(killedRoot), '已核验的崩溃工作目录未清理');
    assert.equal(await db.textFontVersion.count({ where: { familyId: family.familyId } }), sources.length, '重试产生重复版本');
    assert.equal(readdirSync(workRoot).length, 0, '任务工作目录未清理');
  } finally {
    await queue.resume();
    await queue.close();
  }
}
