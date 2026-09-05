import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ThreadRankingService } from '../src/threads/thread-ranking.service';
import { SMART_SCORE_ZSET, SMART_SCORE_READY } from '../src/threads/thread-smart-score';

async function main() {
  assert.equal(process.env.THREAD_RANKING_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  const redisHost = process.env.REDIS_HOST ?? '127.0.0.1';
  for (const host of [base.hostname, redisHost]) assert(['127.0.0.1', 'localhost', '::1'].includes(host));
  const database = `wenyousite_ranking_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const testUrl = new URL(base); testUrl.pathname = `/${database}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const db = new PrismaClient({ datasourceUrl: testUrl.toString() });
  const connection = new Redis({ host: redisHost, port: Number(process.env.REDIS_PORT ?? 6379), db: 14 });
  const redis = new RedisService(connection);
  const ranking = new ThreadRankingService(db as unknown as PrismaService, redis);
  let created = false; let redisOwned = false;
  try {
    assert.equal(await connection.dbsize(), 0, 'Redis DB 14 必须为空，拒绝覆盖既有数据');
    redisOwned = true;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); created = true;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_DATABASE_URL: testUrl.toString() }, stdio: 'pipe',
    });
    const owner = await db.user.create({ data: { email: 'owner@example.invalid', username: '楼主', password: 'unused' } });
    const player = await db.user.create({ data: { email: 'player@example.invalid', username: '玩家', password: 'unused' } });
    for (const id of ['active', 'popular', 'tie-a', 'tie-b', 'old']) {
      await db.thread.create({ data: {
        id, ownerId: owner.id, title: id, published: true,
        publishedAt: new Date(id === 'old' ? '2026-01-01' : '2026-09-01'),
        viewCount: id === 'popular' ? 999999 : 3, likeCount: id === 'popular' ? 10000 : 0,
        tipTotal: id === 'popular' ? 999999999n : 0n,
        subthreads: { create: { id: `${id}-sub`, title: '正文' } },
        members: { create: { userId: player.id, playerMarked: true } },
      } });
    }
    await db.post.create({ data: {
      threadId: 'active', subthreadId: 'active-sub', authorId: player.id, floorNumber: 1, content: '玩家参与创作',
    } });
    await redis.hset('thread:active:stats', 'views', 9);
    await Promise.all([ranking.ensureReady(), ranking.ensureReady()]);
    assert.deepEqual(await redis.zrevrange(SMART_SCORE_ZSET, 0, -1), ['active', 'tie-b', 'tie-a', 'popular', 'old']);
    assert.equal((await db.thread.findUniqueOrThrow({ where: { id: 'active' } })).viewCount, 9);
    await connection.flushdb();
    await ranking.ensureReady();
    assert.deepEqual(await redis.hgetall('thread:popular:stats'), {
      views: '999999', replies: '0', likes: '10000', tips: '999999999',
      createdAt: String((await db.thread.findUniqueOrThrow({ where: { id: 'popular' } })).createdAt.getTime()),
    });
    assert.equal(await redis.hget('thread:active:stats', 'replies'), '1');
    await db.post.updateMany({ where: { threadId: 'active' }, data: { deletedAt: new Date() } });
    await db.thread.update({ where: { id: 'popular' }, data: { deletedAt: new Date() } });
    await ranking.rebuild();
    assert.deepEqual(await redis.zrevrange(SMART_SCORE_ZSET, 0, -1), ['tie-b', 'tie-a', 'active', 'old']);
    await redis.del(SMART_SCORE_ZSET);
    await ranking.ensureReady();
    assert.equal(await redis.zcard(SMART_SCORE_ZSET), 4);
    const original = redis.zaddMultiWithExpiry.bind(redis);
    redis.zaddMultiWithExpiry = async () => { throw new Error('injected staging failure'); };
    await assert.rejects(ranking.rebuild(), /injected staging failure/);
    assert.equal(await redis.zcard(SMART_SCORE_ZSET), 4, '失败不得暴露空或部分排序');
    await redis.del(SMART_SCORE_READY);
    await assert.rejects(ranking.ensureReady(), (error: any) => error.getStatus() === 503);
    redis.zaddMultiWithExpiry = original;
    await ranking.ensureReady();
    console.log('Ranking database recovery, stats, ordering, coalescing and failure checks passed');
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await admin.$disconnect();
    if (redisOwned) await connection.flushdb();
    await connection.quit();
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
