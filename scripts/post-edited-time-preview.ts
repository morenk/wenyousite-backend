/** 楼层编辑时间的合成预览样本；仅使用本轮独立 PG/Redis，不读取线上数据。 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { withResources, unusedPort } from './e2e-resources';
import { businessDate, consumer, load, REPO, sha, stateRoot, verifyConsumer, writePrivate } from './dev-preview/common';
import { captureSnapshot } from './dev-preview/snapshot';
import { start, withLock } from './dev-preview/lifecycle';

async function main() {
  const name = 'post-edited-time';
  if (existsSync(join(stateRoot(), name))) {
    const existing = load(name); await verifyConsumer(existing);
    console.log(JSON.stringify({ event: 'sample-preview-ready', sessionId: name, runId: existing.runId,
      consumerPath: join(existing.root, 'consumer.json'), accountPath: join(existing.root, 'sample-accounts.json'),
      contentPath: join(existing.root, 'sample-content.json'), isolatedSample: true })); return;
  }
  const snapshots = mkdtempSync(join(tmpdir(), 'post-edited-time-sample-snapshots-'));
  const snapshotOwnership = { snapshotRoot: snapshots, sessionId: name, worktree: REPO, sourceRunId: '', sourceCleanup: 'pending' };
  writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
  console.log(JSON.stringify({ event: 'sample-snapshot-registered', ...snapshotOwnership }));
  const username = 'sample_' + randomBytes(6).toString('hex');
  const account = username + '@preview.invalid'; const password = 'Sample!' + randomBytes(18).toString('hex');
  let contentIds: Record<string, string> = {}; let sourceRunId = ''; let started = false;
  try {
    await withResources(async r => {
      sourceRunId = r.runId; snapshotOwnership.sourceRunId = r.runId;
      writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
      await r.verify();
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(REPO, 'prisma/schema.prisma')],
        { cwd: r.root, env: { ...r.env, DATABASE_URL: r.databaseUrl, DIRECT_DATABASE_URL: r.databaseUrl }, stdio: 'pipe' });
      const db = new PrismaClient({ datasourceUrl: r.databaseUrl, log: [] });
      try {
        const user = await db.user.create({ data: { username, email: account, password: await argon2.hash(password) } });
        const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
        const thread = await db.thread.create({ data: { ownerId: user.id, title: '编辑时间展示 · 隔离合成样本', category: category.slug,
          published: true, publishedAt: new Date(), members: { create: { userId: user.id, role: 'OWNER', playerMarked: true } } } });
        const sub = await db.subthread.create({ data: { threadId: thread.id, title: '默认子贴' } });
        await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
        const base = { threadId: thread.id, subthreadId: sub.id, authorId: user.id, createdAt: new Date(Date.now() - 86_400_000) };
        await db.post.create({ data: { ...base, kind: 'BODY', content: '本页为编辑时间联验合成数据，不是真实用户快照。' } });
        const original = await db.post.create({ data: { ...base, floorNumber: 1, content: '未编辑楼层：此处保留原发布时间。' } });
        const edited = await db.post.create({ data: { ...base, floorNumber: 2, content: '已编辑楼层：时间应显示“编辑于…”。', editedAt: new Date(Date.now() - 120_000), version: 2 } });
        const originalReply = await db.post.create({ data: { ...base, parentPostId: edited.id, content: '未编辑楼中楼：此处保留发布时间。' } });
        const editedReply = await db.post.create({ data: { ...base, parentPostId: edited.id, content: '已编辑楼中楼：预览与回复页应显示同一编辑时间。', editedAt: new Date(Date.now() - 60_000), version: 2 } });
        contentIds = { threadId: thread.id, subthreadId: sub.id, originalFloorId: original.id, editedFloorId: edited.id, originalReplyId: originalReply.id, editedReplyId: editedReply.id };
        await captureSnapshot({ output: snapshots, sourceUrl: r.databaseUrl, sourceSha: sha(), mediaOrigin: 'https://media.example.com', pgBin: process.env.E2E_PG_BIN! });
      } finally { await db.$disconnect(); }
    });
    snapshotOwnership.sourceCleanup = 'completed';
    writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
    const port = await unusedPort();
    const session = await withLock(name, () => start(name, { snapshot: join(snapshots, businessDate()), 'web-port': String(port) }));
    started = true;
    writePrivate(join(session.root, 'sample-snapshot-ownership.json'), snapshotOwnership);
    await verifyConsumer(session);
    writePrivate(join(session.root, 'sample-accounts.json'), { version: 1, runId: session.runId, isolatedSample: true, accounts: [{ role: 'USER', account, password }] });
    writePrivate(join(session.root, 'sample-content.json'), { version: 1, runId: session.runId, isolatedSample: true, ...contentIds });
    console.log(JSON.stringify({ event: 'sample-preview-ready', sessionId: name, runId: session.runId, sourceRunId, sourceCleanup: 'completed',
      consumerPath: join(session.root, 'consumer.json'), accountPath: join(session.root, 'sample-accounts.json'),
      contentPath: join(session.root, 'sample-content.json'), backend: consumer(session).backend.origin, webPort: port,
      snapshotCapturedAt: session.snapshot.capturedAt, isolatedSample: true, ...contentIds }));
  } finally { if (!started && !existsSync(join(stateRoot(), name))) rmSync(snapshots, { recursive: true, force: true }); }
}
void main().catch(() => { console.error('合成预览未就绪；检查本任务私有日志，禁止回落线上'); process.exitCode = 1; });
