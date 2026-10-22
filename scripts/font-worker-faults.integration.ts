import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
import { processStart } from './e2e-processes';

type Request = (path: string, method?: string, body?: unknown, status?: number) => Promise<Record<string, any>>;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
