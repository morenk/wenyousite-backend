import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { MediaReferenceService } from '../src/media/media-reference.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  assert.equal(process.env.MEDIA_RECLAMATION_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  assert(['127.0.0.1', 'localhost', '::1'].includes(base.hostname), '只允许 loopback 测试数据库');
  const database = `wenyousite_media_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const testUrl = new URL(base); testUrl.pathname = `/${database}`;
  const db = new PrismaClient({ datasourceUrl: testUrl.toString() });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_DATABASE_URL: testUrl.toString() },
      stdio: 'pipe',
    });
    const user = await db.user.create({ data: { email: 'media-test@example.invalid', username: '回收测试', password: 'unused' } });
    const draft = await db.draft.create({ data: { userId: user.id, slot: 1, content: '测试' } });
    const media = await Promise.all(['bound', 'claimed', 'changed'].map((name) => db.media.create({
      data: { userId: user.id, key: name, url: `https://media.example.invalid/${name}`, status: 'COMPLETED' },
    })));
    const references = new MediaReferenceService(db as unknown as PrismaService);
    let unlock!: () => void;
    let bound!: () => void;
    const canCommit = new Promise<void>((resolve) => { unlock = resolve; });
    const bindingReady = new Promise<void>((resolve) => { bound = resolve; });
    const binding = db.$transaction(async (tx) => {
      await tx.draftMedia.create({ data: { draftId: draft.id, mediaId: media[0].id, sortOrder: 0 } });
      bound();
      await canCommit;
    });
    await bindingReady;
    let claimFinished = false;
    const claim = references.claimUnreferenced([media[0].id], { status: 'COMPLETED' })
      .finally(() => { claimFinished = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(claimFinished, false, '回收必须等待已开始的绑定事务');
    } finally {
      unlock();
    }
    await binding;
    assert.deepEqual(await claim, [], '绑定先完成，回收必须放弃');

    assert.equal((await references.claimUnreferenced([media[1].id], { status: 'COMPLETED' })).length, 1);
    await assert.rejects(db.draftMedia.create({
      data: { draftId: draft.id, mediaId: media[1].id, sortOrder: 1 },
    }), (error: unknown) => {
      assert(error instanceof Error);
      assert(error.message.includes('media_deletion_claimed'));
      return true;
    });
    assert.equal(await db.draftMedia.count({ where: { mediaId: media[1].id } }), 0);
    assert.equal((await references.claimUnreferenced([media[1].id], { deletionClaimedAt: { not: null } })).length, 1,
      '对象删除失败后，领取记录可再次领取重试');
    await assert.rejects(db.media.update({ where: { id: media[1].id }, data: { status: 'PROCESSING' } }));
    await assert.rejects(db.media.update({ where: { id: media[1].id }, data: { deletionClaimedAt: null } }));
    await db.media.update({ where: { id: media[2].id }, data: { status: 'PROCESSING' } });
    assert.deepEqual(await references.claimUnreferenced([media[2].id], { status: 'COMPLETED' }), []);

    const coverage = await db.$queryRaw<Array<{ missing: bigint }>>`
      SELECT count(*) AS missing FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'media'::regclass
        AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.conrelid
          AND t.tgname = 'guard_media_' || a.attname)
    `;
    assert.equal(coverage[0].missing, 0n, '所有 Media 外键都必须具有绑定保护');
    console.log('Media reclamation migration, binding races and retry checks passed');
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await admin.$disconnect();
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
