import assert from 'node:assert/strict';
import S3rver from 's3rver';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
import { unusedPort } from './e2e-resources';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { MediaService } from '../src/media/media.service';
import { MediaProcessingService } from '../src/media/media-processing.service';
import { MediaReferenceService } from '../src/media/media-reference.service';
import { AudioProcessingService } from '../src/media/audio-processing.service';
import { AudioProjectionService } from '../src/media/audio-projection.service';
import { AudioRuntimeService } from '../src/media/audio-runtime.service';
import { ImageProcessor } from '../src/media/image.processor';

async function main() {
  assert.equal(process.env.AUDIO_TEST_ENV, 'test');
  const manifest = assertIsolatedEnvironment();
  await verifyIsolatedEnvironment();
  const appUrl = new URL(process.env.AUDIO_TEST_APP_URL!);
  assert.equal(appUrl.username, 'wenyousite_app');
  assert.equal(+appUrl.port, manifest.postgres.port);
  const db = new PrismaClient({ datasourceUrl: appUrl.toString() });
  const prisma = db as unknown as PrismaService;
  const connection = {
    host: '127.0.0.1',
    port: manifest.redis.port,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  };
  const redis = new Redis(connection);
  const queue = new Queue('audio-' + manifest.runId, { connection });
  const events = new QueueEvents(queue.name, { connection });
  const directory = join(manifest.uploadPath, 'audio');
  mkdirSync(directory, { recursive: true });
  const port = await unusedPort();
  // 本轮上传路径和随机端口；不读取 COS 环境，不接触真实桶。
  const s3 = new S3rver({
    directory,
    address: '127.0.0.1',
    port,
    silent: true,
    configureBuckets: [{ name: 'audio-e2e' }],
  });
  let worker: Worker | undefined;
  try {
    await s3.run();
    await events.waitUntilReady();
    const endpoint = `http://127.0.0.1:${port}`;
    const config = new ConfigService({
      cos: {
        endpoint,
        bucket: 'audio-e2e',
        region: 'auto',
        accessKeyId: 'S3RVER',
        secretAccessKey: 'S3RVER',
      },
      audio: { enabled: true, runtimeDirectory: resolve('.cache/audio-runtime') },
      upload: { ratePerHour: 60 },
    });
    const storage = new ObjectStorageService(config);
    storage.publicUrl = (key) => 'https://audio.e2e.invalid/media-root/' + key;
    const images = new MediaProcessingService(prisma, storage);
    const runtime = new AudioRuntimeService(config);
    const audio = new AudioProcessingService(prisma, storage, images, runtime);
    const references = new MediaReferenceService(prisma);
    const service = new MediaService(
      config,
      prisma,
      new RedisService(redis),
      references,
      storage,
      images,
      queue,
      runtime,
      audio,
    );
    const processor = new ImageProcessor(images, audio, prisma);
    worker = new Worker(queue.name, (job) => processor.process(job), {
      connection,
      concurrency: 2,
    });
    const userId = process.env.E2E_USER_ID!;
    const post = await db.post.findFirstOrThrow({ where: { authorId: userId, kind: 'BODY' } });
    const source = join(directory, 'source.wav');
    execFileSync(
      runtime.requireReady().ffmpeg,
      ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=0.2', '-c:a', 'pcm_s16le', source],
      { env: {}, timeout: 10000 },
    );
    const bytes = readFileSync(source);
    async function upload(body: Buffer) {
      const signed = await service.getUploadUrl({
        userId,
        purpose: 'RICH_CONTENT_AUDIO',
        filename: 'sample.wav',
        contentType: 'audio/wav',
        size: body.length,
      });
      const put = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/wav' },
        body: new Uint8Array(body),
      });
      assert(put.ok);
      await service.confirmUpload(signed.mediaId, userId);
      const job = await queue.getJob(signed.mediaId);
      assert(job);
      return { signed, job };
    }
    const { signed, job } = await upload(bytes);
    await job.waitUntilFinished(events, 20000);
    const media = await db.media.findUniqueOrThrow({ where: { id: signed.mediaId } });
    assert.equal(media.status, 'COMPLETED');
    assert.equal(media.contentType, 'audio/mpeg');
    assert(media.durationMs! > 0);
    assert.equal(media.stagingKey, null);
    const head = await storage.head(media.key);
    assert.match(head.CacheControl!, /immutable/);
    assert.equal(head.ContentType, 'audio/mpeg');
    const range = await fetch(`${endpoint}/audio-e2e/${media.key}`, {
      headers: { Range: 'bytes=0-99' },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    await assert.rejects(storage.head(signed.objectKey));
    const markdown = `[**自定义**片段](${media.url})`;
    await db.$transaction(async (tx) => {
      await tx.post.update({ where: { id: post.id }, data: { content: markdown } });
      await references.syncPostContent(tx, post.id, markdown, userId);
    });
    assert.equal(await db.postMedia.count({ where: { postId: post.id, mediaId: media.id } }), 1);
    const projected: { id: string; threadId: string; content: string; mediaAudios?: unknown[] } = {
      id: post.id,
      threadId: post.threadId,
      content: markdown,
    };
    const projection = new AudioProjectionService(prisma);
    await projection.project(projected);
    assert.equal(projected.mediaAudios?.length, 1);
    const unbound = {
      id: 'not-this-post',
      threadId: post.threadId,
      content: markdown,
      mediaAudios: [],
    };
    await projection.project(unbound);
    assert.deepEqual(unbound.mediaAudios, []);
    const other = await db.user.create({
      data: {
        username: 'audio_other_' + manifest.runId,
        email: manifest.runId + '@audio.e2e.invalid',
        password: 'unused',
      },
    });
    // 已有关系可被有编辑权的协作者保留；新绑定其他作者音频拒绝且事务无半写入。
    await db.$transaction((tx) => references.syncPostContent(tx, post.id, markdown, other.id));
    const draft = await db.draft.create({ data: { userId: other.id, slot: 1, content: '' } });
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.draft.update({ where: { id: draft.id }, data: { content: markdown } });
        await references.syncDraftContent(tx, draft.id, markdown, other.id);
      }),
    );
    assert.equal((await db.draft.findUniqueOrThrow({ where: { id: draft.id } })).content, '');
    await db.$transaction((tx) =>
      references.syncPostContent(tx, post.id, markdown + '\n\n' + markdown, userId),
    );
    assert.equal(await db.postMedia.count({ where: { postId: post.id } }), 1);
    await db.$transaction((tx) => references.syncPostContent(tx, post.id, '', userId));
    assert((await db.media.findUniqueOrThrow({ where: { id: media.id } })).orphanedAt);
    let concurrent: Promise<unknown> | undefined;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM media WHERE id = ${media.id} FOR UPDATE`;
      concurrent = db.$transaction(otherTx => references.syncPostContent(otherTx, post.id, markdown, userId));
      // 在持锁期间领取回收；后到的引用写入必须重新观察到领取标记。
      await tx.media.update({where:{id:media.id},data:{deletionClaimedAt:new Date()}});
    });
    await assert.rejects(concurrent!);
    assert.equal(await db.postMedia.count({where:{postId:post.id,mediaId:media.id}}),0);
    await service.cleanupOrphanMedia();
    assert.equal(await db.media.findUnique({where:{id:media.id}}),null);
    await assert.rejects(storage.head(media.key));
    const bad = await upload(Buffer.from('not a wave'));
    await assert.rejects(bad.job.waitUntilFinished(events, 20000));
    const failed = await db.media.findUniqueOrThrow({ where: { id: bad.signed.mediaId } });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.failureCode, 'AUDIO_INVALID');
    assert.equal(failed.stagingKey, null);
    const unauth = await fetch(manifest.apiBase + '/media/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'a.mp3',
        contentType: 'audio/mpeg',
        size: 100,
        purpose: 'RICH_CONTENT_AUDIO',
      }),
    });
    assert.equal(unauth.status, 401);
    const login = await fetch(manifest.apiBase + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD }),
    });
    assert(login.ok);
    const token = (await login.json()).data.accessToken;
    assert(token);
    const disabled = await fetch(manifest.apiBase + '/media/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        filename: 'a.mp3',
        contentType: 'audio/mpeg',
        size: 100,
        purpose: 'RICH_CONTENT_AUDIO',
      }),
    });
    assert.equal(disabled.status, 503);
    const meta = await fetch(manifest.apiBase + '/meta');
    assert(meta.ok);
    assert.equal((await meta.json()).data.audioUpload, undefined);
    assert.equal(
      (await db.$queryRaw<{ current_user: string }[]>`SELECT current_user`)[0].current_user,
      'wenyousite_app',
    );
    console.log(
      JSON.stringify({
        event: 'audio-passed',
        runId: manifest.runId,
        storage: 'isolated-s3rver',
        range: 206,
        migration: true,
        queueRetry: true,
        referenceAuthorization: true,
        transactionRollback: true,
      }),
    );
  } finally {
    await worker?.close();
    await events.close();
    await queue.close();
    redis.disconnect();
    await db.$disconnect();
    await s3.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
