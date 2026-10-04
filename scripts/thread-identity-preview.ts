/** 帖内身份与逐条身份选择的合成预览样本；仅使用本轮独立 PG/Redis，不读取线上数据。 */
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
  const name = 'rp-identity-v1';
  if (existsSync(join(stateRoot(), name))) {
    const existing = load(name); await verifyConsumer(existing);
    console.log(JSON.stringify({ event: 'sample-preview-ready', sessionId: name, runId: existing.runId,
      consumerPath: join(existing.root, 'consumer.json'), accountPath: join(existing.root, 'sample-accounts.json'),
      contentPath: join(existing.root, 'sample-content.json'), isolatedSample: true })); return;
  }
  const snapshots = mkdtempSync(join(tmpdir(), 'rp-identity-v1-sample-snapshots-'));
  const snapshotOwnership = { snapshotRoot: snapshots, sessionId: name, worktree: REPO, sourceRunId: '', sourceCleanup: 'pending' };
  writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
  console.log(JSON.stringify({ event: 'sample-snapshot-registered', ...snapshotOwnership }));
  const actors = ['OWNER', 'COLLABORATOR', 'PLAYER', 'DUPLICATE_PLAYER', 'READER'].map(role => {
    const username = 'rp_' + randomBytes(6).toString('hex');
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
        for (const actor of actors) users.push(await db.user.create({ data: { username: actor.username, email: actor.account, password: await argon2.hash(actor.password) } }));
        const [owner, collab, player, duplicate, reader] = users;
        const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
        const thread = await db.thread.create({ data: { ownerId: owner.id, title: '帖内身份 · 隔离合成样本', category: category.slug,
          rpIdentityEnabled: true, published: true, publishedAt: new Date(), members: { create: [
            { userId: owner.id, role: 'OWNER' }, { userId: collab.id, role: 'COLLABORATOR' },
            { userId: player.id, playerMarked: true }, { userId: duplicate.id, playerMarked: true }, { userId: reader.id },
          ] } } });
        const sub = await db.subthread.create({ data: { threadId: thread.id, title: '身份演示', postingPolicy: 'PARTICIPANTS' } });
        const otherSub = await db.subthread.create({ data: { threadId: thread.id, title: '同主题的第二子贴', sortOrder: 1, postingPolicy: 'PARTICIPANTS' } });
        await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
        const identities: Array<{ id: string; nickname: string | null }> = [];
        for (const [index, nickname] of ['主持人', '协作主持', '白鸦', '白鸦'].entries()) {
          identities.push(await db.threadIdentity.create({ data: { threadId: thread.id, userId: users[index].id, nickname, aliases: { create: [{ nickname }, ...(index === 2 ? [{ nickname: '夜渡' }] : [])] } } }));
        }
        const snapshot = (index: number, nickname?: string) => ({ authorIdentitySnapshot: { id: identities[index].id, nickname: nickname ?? identities[index].nickname!, avatar: null, avatarMediaId: null }, identityCreateMode: 'RP' });
        const base = { threadId: thread.id, subthreadId: sub.id, createdAt: new Date(Date.now() - 86_400_000) };
        await db.post.create({ data: { ...base, authorId: owner.id, kind: 'BODY', ...snapshot(0), content: '本页为帖内身份联验合成数据，不是真实用户快照。可逐条选择站内账号或 RP，修改角色只影响后续发言。' } });
        const historical = await db.post.create({ data: { ...base, authorId: player.id, floorNumber: 1, ...snapshot(2, '夜渡'), content: '这一楼用旧角色名「夜渡」发表；当前昵称已改为「白鸦」。点击头像可比较历史与当前身份。' } });
        const accountPost = await db.post.create({ data: { ...base, authorId: player.id, floorNumber: 2, identityCreateMode: 'ACCOUNT', content: '同一个账号，这一楼明确选择站内身份。角色修改与开关都不应把它变为 RP。' } });
        await db.post.create({ data: { ...base, authorId: duplicate.id, floorNumber: 3, ...snapshot(3), content: '另一位玩家也叫白鸦；提及候选与筛选目录要用真实用户名区分。' } });
        await db.post.create({ data: { ...base, authorId: collab.id, floorNumber: 4, ...snapshot(1), content: '协作者无需被标记为玩家也可使用帖内身份。' } });
        await db.post.create({ data: { ...base, authorId: reader.id, floorNumber: 5, identityCreateMode: 'ACCOUNT', content: '普通读者可以看身份卡，也可以按原发言权限发表，但不能自定义帖内身份。' } });
        const content = `历史提及 [@夜渡](/users/${player.id}) 与 [@白鸦](/users/${player.id}) 始终指向同一账号。`;
        const reply = await db.post.create({ data: { ...base, authorId: owner.id, parentPostId: historical.id, replyToPostId: historical.id, replyNumber: 1, ...snapshot(0), content,
          mentionIdentitySnapshots: ['夜渡', '白鸦'].map(label => ({ userId: player.id, label, identityId: identities[2].id })) } });
        const other = await db.thread.create({ data: { ownerId: owner.id, title: '另一主题 · 没有套用其他帖身份', category: category.slug, published: true, publishedAt: new Date(), members: { create: { userId: owner.id, role: 'OWNER' } } } });
        const normalSub = await db.subthread.create({ data: { threadId: other.id, title: '默认子贴' } });
        await db.thread.update({ where: { id: other.id }, data: { defaultSubthreadId: normalSub.id } });
        await db.post.create({ data: { threadId: other.id, subthreadId: normalSub.id, authorId: owner.id, kind: 'BODY', content: '另一个主题的账号资料独立。' } });
        contentIds = { threadId: thread.id, subthreadId: sub.id, secondSubthreadId: otherSub.id, historicalFloorId: historical.id, accountFloorId: accountPost.id, replyId: reply.id, otherThreadId: other.id };
        await captureSnapshot({ sourceKind: 'synthetic-thread-identities', output: snapshots, sourceUrl: r.databaseUrl, sourceSha: sha(), mediaOrigin: 'https://media.example.com', pgBin: process.env.E2E_PG_BIN! });
      } finally { await db.$disconnect(); }
    });
    snapshotOwnership.sourceCleanup = 'completed';
    writePrivate(join(snapshots, 'sample-snapshot-ownership.json'), snapshotOwnership);
    const port = await unusedPort();
    const session = await withLock(name, () => start(name, { snapshot: join(snapshots, businessDate()), 'web-port': String(port) }));
    started = true;
    writePrivate(join(session.root, 'sample-snapshot-ownership.json'), snapshotOwnership);
    await verifyConsumer(session);
    writePrivate(join(session.root, 'sample-accounts.json'), { version: 1, runId: session.runId, isolatedSample: true, accounts: actors.map(({ role, account, password }) => ({ role, account, password })) });
    writePrivate(join(session.root, 'sample-content.json'), { version: 1, runId: session.runId, isolatedSample: true, ...contentIds });
    console.log(JSON.stringify({ event: 'sample-preview-ready', sessionId: name, runId: session.runId, sourceRunId, sourceCleanup: 'completed',
      consumerPath: join(session.root, 'consumer.json'), accountPath: join(session.root, 'sample-accounts.json'),
      contentPath: join(session.root, 'sample-content.json'), backend: consumer(session).backend.origin, webPort: port,
      snapshotCapturedAt: session.snapshot.capturedAt, isolatedSample: true, ...contentIds }));
  } finally { if (!started && !existsSync(join(stateRoot(), name))) rmSync(snapshots, { recursive: true, force: true }); }
}
void main().catch(() => { console.error('RP 合成预览未就绪；检查本任务私有日志，禁止回落线上'); process.exitCode = 1; });
