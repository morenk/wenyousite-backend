/** 私帖邀请复用的合成预览样本；仅使用本轮独立 PG/Redis，不读取线上数据。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { withResources } from './e2e-resources';
import { businessDate, consumer, load, privateFile, REPO, sha, stateRoot, verifyConsumer, writePrivate } from './dev-preview/common';
import { captureSnapshot } from './dev-preview/snapshot';
import { start, withLock } from './dev-preview/lifecycle';

async function main() {
  const name = 'private-invite-reuse';
  if (existsSync(join(stateRoot(), name))) {
    // load 同时校验 worktree === REPO、UID 和 ownership 登记；不接管同名的其他任务。
    const existing = load(name); await verifyConsumer(existing);
    for (const file of ['sample-accounts.json', 'sample-content.json']) {
      const sample = JSON.parse(readFileSync(privateFile(join(existing.root, file)), 'utf8'));
      assert(sample.version === 1 && sample.runId === existing.runId && sample.isolatedSample === true, '合成样本归属不符');
    }
    console.log(JSON.stringify({ event: 'sample-preview-ready', sessionId: name, runId: existing.runId,
      consumerPath: join(existing.root, 'consumer.json'), accountPath: join(existing.root, 'sample-accounts.json'),
      contentPath: join(existing.root, 'sample-content.json'), isolatedSample: true })); return;
  }
  const snapshots = mkdtempSync(join(tmpdir(), 'private-invite-reuse-sample-snapshots-'));
  const snapshotOwnership = { snapshotRoot: snapshots, sessionId: name, worktree: REPO, sourceRunId: '', sourceCleanup: 'pending' };
  writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
  console.log(JSON.stringify({ event: 'sample-snapshot-registered', ...snapshotOwnership }));
  const accounts = ['OWNER', 'MEMBER', 'NEWCOMER'].map(role => {
    const username = 'sample_' + randomBytes(6).toString('hex');
    return { role, username, account: username + '@preview.invalid', password: 'Sample!' + randomBytes(18).toString('hex') };
  });
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
        const users = [];
        for (const account of accounts) {
          users.push(await db.user.create({ data: { username: account.username, email: account.account, password: await argon2.hash(account.password) } }));
        }
        const [owner, member, newcomer] = users;
        const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
        const thread = await db.thread.create({ data: { ownerId: owner.id, title: '私帖邀请复用 · 隔离合成样本', category: category.slug,
          visibility: 'PRIVATE', published: true, publishedAt: new Date(), members: { create: [
            { userId: owner.id, role: 'OWNER', playerMarked: true }, { userId: member.id, role: 'PARTICIPANT' },
          ] } } });
        const sub = await db.subthread.create({ data: { threadId: thread.id, title: '默认子贴' } });
        await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
        await db.post.create({ data: { threadId: thread.id, subthreadId: sub.id, authorId: owner.id, kind: 'BODY',
          content: '本页为私帖邀请复用联验合成数据，不是真实用户快照。复制应复用当前链接；主动重置后已有成员仍可阅读。' } });
        contentIds = { threadId: thread.id, subthreadId: sub.id, ownerId: owner.id, memberId: member.id, newcomerId: newcomer.id };
        await captureSnapshot({ output: snapshots, sourceUrl: r.databaseUrl, sourceSha: sha(), mediaOrigin: 'https://media.example.com', pgBin: process.env.E2E_PG_BIN! });
      } finally { await db.$disconnect(); }
    });
    snapshotOwnership.sourceCleanup = 'completed';
    writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
    const port = 43931;
    const session = await withLock(name, () => start(name, { snapshot: join(snapshots, businessDate()), 'web-port': String(port) }));
    started = true;
    writePrivate(join(session.root, 'sample-snapshot-ownership.json'), snapshotOwnership);
    await verifyConsumer(session);
    writePrivate(join(session.root, 'sample-accounts.json'), { version: 1, runId: session.runId, isolatedSample: true, accounts });
    writePrivate(join(session.root, 'sample-content.json'), { version: 1, runId: session.runId, isolatedSample: true, ...contentIds });
    console.log(JSON.stringify({ event: 'sample-preview-ready', sessionId: name, runId: session.runId, sourceRunId, sourceCleanup: 'completed',
      consumerPath: join(session.root, 'consumer.json'), accountPath: join(session.root, 'sample-accounts.json'),
      contentPath: join(session.root, 'sample-content.json'), backend: consumer(session).backend.origin, webPort: port,
      snapshotCapturedAt: session.snapshot.capturedAt, isolatedSample: true, ...contentIds }));
  } finally { if (!started && !existsSync(join(stateRoot(), name))) rmSync(snapshots, { recursive: true, force: true }); }
}
void main().catch(() => { console.error('合成预览未就绪；检查本任务私有日志，禁止回落线上'); process.exitCode = 1; });
