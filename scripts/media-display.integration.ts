import { MediaReferenceService } from '../src/media/media-reference.service';
import { mediaDisplayCleanupProtection } from '../src/media/media-display-reclamation';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { gif } from '../src/common/image-inspection.fixtures';
import { inspectImage } from '../src/common/image-inspection';
import { PrismaService } from '../src/prisma/prisma.service';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { MediaProcessingService } from '../src/media/media-processing.service';
import { ensureAnimationDisplay, processHistoricalDisplay } from '../src/media/media-display-publisher';
import { cleanupMediaPreviewAttempts } from '../src/media/media-preview-cleanup';
import { MediaDisplayProjectionService } from '../src/media/media-display-projection.service';
import { readMediaDisplay } from '../src/media/media-display';

async function main() {
  assert.equal(process.env.MEDIA_DISPLAY_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), '只允许 loopback');
  assert.equal(base.port, '55432', '仅允许既有隔离 loadtest PostgreSQL，不允许生产端口');
  const suffix = randomUUID().replaceAll('-', '');
  const database = `wenyousite_display_test_${suffix}`;
  const role = `display_app_${suffix}`;
  const password = randomBytes(24).toString('hex');
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const ownerUrl = new URL(base); ownerUrl.pathname = '/' + database;
  const owner = new PrismaClient({ datasourceUrl: ownerUrl.toString() });
  const appUrl = new URL(ownerUrl); appUrl.username = role; appUrl.password = password;
  const app = new PrismaClient({ datasourceUrl: appUrl.toString() });
  let databaseCreated = false;
  let roleCreated = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env: { ...process.env,
      DATABASE_URL: ownerUrl.toString(), DIRECT_DATABASE_URL: ownerUrl.toString() }, stdio: 'pipe' });
    await admin.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    roleCreated = true;
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await owner.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
    await owner.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
    const identity = await app.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    assert.equal(identity[0].current_user, role);
    const user = await app.user.create({ data: { email: 'display-test@example.invalid', username: '展示隔离测试', password: 'unused' } });
    const source = await gif(32, 24, 3, 120);
    const files = new Map<string, Buffer>();
    const storage = {
      download: async (key: string) => { const bytes = files.get(key); assert(bytes); return bytes; },
      upload: async (key: string, body: Buffer) => { files.set(key, body); },
      publicUrl: (key: string) => 'https://display.example.invalid/' + key,
      remove: async (key: string) => { files.delete(key); },
    } as unknown as ObjectStorageService;
    const prisma = app as unknown as PrismaService;
    const create = async (name: string, status: 'PROCESSING' | 'COMPLETED') => {
      const key = `media/${name}.gif`; files.set(key, source); files.set(`staging/${name}.gif`, source);
      return app.media.create({ data: { userId: user.id, key, url: storage.publicUrl(key),
        stagingKey: status === 'PROCESSING' ? `staging/${name}.gif` : null,
        status, purpose: 'RICH_CONTENT', contentType: 'image/gif', animated: true } });
    };
    const first = await create('new', 'PROCESSING');
    await new MediaProcessingService(prisma, storage).processImage(first.id);
    const completed = await app.media.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.url, first.url);
    assert.equal(completed.contentType, 'image/gif'); assert(files.get(first.key)?.equals(source));
    const display = readMediaDisplay(completed.displayAsset); assert(display);
    assert.equal(display.frameCount, 3); assert.equal(display.durationMs, 360);
    const published = await app.mediaPreviewAttempt.findFirstOrThrow({ where: { mediaId: first.id, status: 'PUBLISHED', keys: { has: display.url.replace('https://display.example.invalid/', '') } } });
    assert.equal((await inspectImage(files.get(published.keys[0])!)).format, 'webp');
    assert.equal(completed.stagingKey, null);

    const historical = await create('historical', 'COMPLETED');
    await app.media.update({ where: { id: historical.id }, data: { contentType: null, animated: true } });
    await processHistoricalDisplay(prisma, storage, historical.id);
    const after = await app.media.findUniqueOrThrow({ where: { id: historical.id } });
    assert.equal(after.status, 'COMPLETED'); assert.equal(after.url, historical.url); assert.equal(after.displayAttempts, 1);
    await processHistoricalDisplay(prisma, storage, historical.id);
    assert.equal((await app.media.findUniqueOrThrow({ where: { id: historical.id } })).displayAttempts, 1);

    const race = await create('race', 'COMPLETED');
    const winners = await Promise.all([ensureAnimationDisplay(prisma, storage, race, source), ensureAnimationDisplay(prisma, storage, race, source)]);
    assert.equal(winners[0].url, winners[1].url);
    assert.equal(await app.mediaPreviewAttempt.count({ where: { mediaId: race.id, status: 'PUBLISHED' } }), 1);
    const pending = await app.mediaPreviewAttempt.findFirstOrThrow({ where: { mediaId: race.id, status: 'PENDING' } });
    await app.mediaPreviewAttempt.update({ where: { id: pending.id }, data: { expiresAt: new Date(0), nextCleanupAt: new Date(0) } });
    assert.equal(await cleanupMediaPreviewAttempts(prisma, storage), 1);
    assert(!files.has(pending.keys[0])); assert(files.has(winners[0].url.replace('https://display.example.invalid/', '')));

    // 真事务强制两个并发顺序：删除先领取则不登记/PUT；登记先行则在途 PUT 和墓碑保护 Media。
    const refs = new MediaReferenceService(prisma);
    const deletionFirst = await create('deletion-first', 'COMPLETED');
    assert.equal((await refs.claimUnreferenced([deletionFirst.id], mediaDisplayCleanupProtection())).length, 1);
    await assert.rejects(ensureAnimationDisplay(prisma, storage, deletionFirst, source), /DISPLAY_MEDIA_UNAVAILABLE/);
    assert.equal(await app.mediaPreviewAttempt.count({ where: { mediaId: deletionFirst.id } }), 0);
    const uploadFirst = await create('upload-first', 'COMPLETED');
    let releasePut!: () => void;
    let putStarted!: () => void;
    const entered = new Promise<void>((resolve) => { putStarted = resolve; });
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    const delayed = { ...storage, upload: async () => { putStarted(); await putGate; throw new Error('EXPECTED_PUT_FAILED'); } } as unknown as ObjectStorageService;
    const inFlight = ensureAnimationDisplay(prisma, delayed, uploadFirst, source);
    const expectedFailure = assert.rejects(inFlight, /EXPECTED_PUT_FAILED/);
    await entered;
    assert.equal((await refs.claimUnreferenced([uploadFirst.id], mediaDisplayCleanupProtection())).length, 0);
    releasePut(); await expectedFailure;
    const held = await app.mediaPreviewAttempt.findFirstOrThrow({ where: { mediaId: uploadFirst.id } });
    await app.mediaPreviewAttempt.update({ where: { id: held.id }, data: { expiresAt: new Date(0), nextCleanupAt: new Date(0) } });
    assert.equal((await refs.claimUnreferenced([uploadFirst.id], mediaDisplayCleanupProtection())).length, 0);
    await cleanupMediaPreviewAttempts(prisma, storage);
    assert.equal((await refs.claimUnreferenced([uploadFirst.id], mediaDisplayCleanupProtection())).length, 1);
    const leased = await create('display-lease', 'COMPLETED');
    await app.media.update({ where: { id: leased.id }, data: { displayStatus: 'PROCESSING', displayStartedAt: new Date() } });
    assert.equal((await refs.claimUnreferenced([leased.id], mediaDisplayCleanupProtection())).length, 0);
    await app.media.update({ where: { id: leased.id }, data: { displayStartedAt: new Date(0) } });
    assert.equal((await refs.claimUnreferenced([leased.id], mediaDisplayCleanupProtection())).length, 1);

    const rollback = await create('rollback', 'COMPLETED');
    await assert.rejects(app.$transaction(async (tx) => {
      await tx.media.update({ where: { id: rollback.id }, data: { displayAsset: display, displayStatus: 'READY' } });
      throw new Error('expected rollback');
    }));
    assert.equal((await app.media.findUniqueOrThrow({ where: { id: rollback.id } })).displayAsset, null);
    const draft = await app.draft.create({ data: { userId: user.id, slot: 1, content: `![x](${first.url})` } });
    await app.draftMedia.create({ data: { draftId: draft.id, mediaId: first.id, sortOrder: 0 } });
    const projected = await new MediaDisplayProjectionService(prisma).project(draft) as typeof draft & { mediaDisplays: unknown[] };
    assert.equal(projected.mediaDisplays.length, 1);
    const unbound = await new MediaDisplayProjectionService(prisma).project({ ...draft, id: 'not-bound' }) as typeof draft & { mediaDisplays: unknown[] };
    assert.equal(unbound.mediaDisplays.length, 0);
    // 旧消费者只读来源字段依然成立；回滚旧应用无需回滚新增可空列。
    assert.equal((await app.media.findUniqueOrThrow({ where: { id: first.id }, select: { url: true } })).url, first.url);
    await assert.rejects(app.$executeRawUnsafe('CREATE TABLE forbidden_owner_operation (id integer)'));
    console.log('MEDIA_DISPLAY_INTEGRATION_OK migration/non-owner/new/legacy/idempotency/CAS/cleanup/registration-delete-race/lease-tombstone/rollback/authorized-projection');
  } finally {
    await app.$disconnect(); await owner.$disconnect();
    if (databaseCreated) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    if (roleCreated) await admin.$executeRawUnsafe(`DROP ROLE "${role}"`);
    await admin.$disconnect();
  }
}
void main().catch(() => { process.stderr.write('MEDIA_DISPLAY_INTEGRATION_FAILED\n', () => process.exit(1)); });
