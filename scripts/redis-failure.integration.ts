import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createCache } from 'cache-manager';
import { createKeyv } from '@keyv/redis';
import { redisConnectionUrl } from '../src/redis/redis-connection';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { BoundedRedisQueue, ReconnectRedisWorker } from '../src/redis/redis-queue';
import type { RedisConnectionOptions } from '../src/redis/redis-connection';
import { MobilePushProducer } from '../src/mobile-push/mobile-push.producer';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createRequestRedis, REDIS_COMMAND_TIMEOUT_MS } from '../src/redis/redis-client-policy';
import { createCacheStore } from '../src/redis/redis-cache';
import { CacheService } from '../src/redis/cache.service';
import { RedisService } from '../src/redis/redis.service';
import { ThrottlerRedisStorage } from '../src/redis/throttler-redis.storage';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { OutboxService } from '../src/outbox/outbox.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { NotificationEligibilityService } from '../src/notifications/notification-eligibility.service';
import { ThreadAccessService } from '../src/access/thread-access.service';
import { RedisFaultProxy } from './redis-fault-proxy';

const WAIT_MS = REDIS_COMMAND_TIMEOUT_MS + 2500;
const evidence: Array<{ check: string; milliseconds: number }> = [];
async function deadline<T>(promise: Promise<T>, budget = WAIT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('隔离故障断言超时')), budget);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function check(name: string, operation: () => Promise<void>) {
  const started = performance.now();
  await operation();
  const result = { check: name, milliseconds: Math.round(performance.now() - started) };
  evidence.push(result);
  console.log(JSON.stringify({ event: 'redis-fault-check', ...result }));
}
async function rejectsWithin(operation: Promise<unknown>) {
  const started = performance.now();
  const outcome = await deadline(operation.then(() => 'resolved', () => 'rejected'));
  assert.equal(outcome, 'rejected');
  assert(performance.now() - started < WAIT_MS);
}
async function ready(client: Redis) {
  const until = Date.now() + 8000;
  for (;;) {
    try { if (await deadline(client.ping()) === 'PONG') return; } catch { /* 仅测试恢复屏障重试只读PING。 */ }
    assert(Date.now() < until, '本轮 Redis 客户端未恢复');
    await delay(50);
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}

let handlerCalls = 0;
@Controller('redis-fault-probe')
class ProbeController {
  @Post('sensitive')
  sensitive() { handlerCalls += 1; return { accepted: true }; }
}

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.REDIS_FAILURE_TEST_ENV, 'test');
  const targetPort = Number(process.env.REDIS_PORT);
  const connection = { host: '127.0.0.1', port: targetPort, db: 0, password: process.env.REDIS_PASSWORD };
  const proxy = await new RedisFaultProxy(targetPort).listen();
  const proxied = { ...connection, port: proxy.port };
  const client = createRequestRedis(proxied);
  const observer = new Redis({ ...connection, maxRetriesPerRequest: 0, retryStrategy: () => null, commandTimeout: 1000 });
  observer.on('error', () => undefined);
  const store = createCacheStore(proxied);
  const manager = createCache({ stores: [store] });
  const cache = new CacheService(manager);
  const redis = new RedisService(client);
  const appUrl = new URL(process.env.BOOKMARK_COUNT_TEST_APP_URL!);
  const ownerUrl = new URL(process.env.DATABASE_URL!);
  assert.equal(appUrl.username, 'wenyousite_app');
  assert.equal(appUrl.host + appUrl.pathname, ownerUrl.host + ownerUrl.pathname);
  const db = new PrismaClient({ datasourceUrl: appUrl.toString(), log: [] });
  let app: NestFastifyApplication | undefined;
  try {
    await ready(client);
    await observer.ping();
    assert.equal((await db.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`)[0].role, 'wenyousite_app');
    await check('request-reply-loss-does-not-replay-increment', async () => {
      const key = 'fault:increment:' + randomUUID();
      proxy.setFault('drop-replies');
      await rejectsWithin(client.incr(key));
      // 回复丢失前命令确实已落Redis；恢复后不能把同一条命令再执行一次。
      assert.equal(await observer.get(key), '1');
      proxy.setFault('pass');
      await ready(client);
      await delay(100);
      assert.equal(await observer.get(key), '1');
    });
    await check('offline-write-is-not-queued-for-recovery', async () => {
      const key = 'fault:offline:' + randomUUID();
      proxy.setFault('disconnected');
      await delay(50);
      await rejectsWithin(client.set(key, 'must-not-appear'));
      proxy.setFault('pass');
      await ready(client);
      assert.equal(await observer.get(key), null);
    });
    await check('request-during-handshake-blackhole-fails-fast', async () => {
      proxy.setFault('drop-requests');
      const connecting = createRequestRedis(proxied);
      try { await rejectsWithin(connecting.ping()); }
      finally { connecting.disconnect(); proxy.setFault('pass'); }
    });
    await ready(client);
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({
        throttlers: [{ name: 'default', ttl: 60000, limit: 100000 }],
        storage: new ThrottlerRedisStorage(client),
      })],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()) + '/redis-fault-probe/sensitive';
    await check('http-throttle-fails-closed-with-original-envelope', async () => {
      const healthy = await fetch(url, { method: 'POST' });
      assert.equal(healthy.status, 201);
      const callsBefore = handlerCalls;
      proxy.setFault('drop-replies');
      const response = await deadline(fetch(url, { method: 'POST' }));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { code: 50000, message: '服务器内部错误', data: null });
      assert.equal(handlerCalls, callsBefore);
      proxy.setFault('pass'); await ready(client);
      assert.equal((await fetch(url, { method: 'POST' })).status, 201);
      assert.equal(handlerCalls, callsBefore + 1);
    });
    await check('cache-existing-key-format-remains-readable', async () => {
      const legacy = createKeyv(redisConnectionUrl(connection));
      const key = cache.buildKey('legacy-fault', randomUUID());
      try {
        await deadline(legacy.set(key, { legacy: true }, 60000));
        assert.deepEqual(await deadline(cache.get(key)), { legacy: true });
        await deadline(cache.set(key, { current: true }, 60000));
        assert.deepEqual(await deadline(legacy.get(key)), { current: true });
      } finally { await legacy.disconnect(); }
    });
    await check('cache-failure-and-recovery-without-deferred-write', async () => {
      const key = cache.buildKey('fault', randomUUID());
      await deadline(cache.set(key, { original: true }, 60000));
      assert.deepEqual(await deadline(cache.get(key)), { original: true });
      proxy.setFault('drop-replies');
      assert.equal(await deadline(cache.get(key)), undefined);
      proxy.setFault('disconnected');
      await deadline(cache.set(key, { stale: true }, 60000));
      proxy.setFault('pass');
      await ready(client);
      const until = Date.now() + 8000;
      while (await cache.get(key) === undefined) { assert(Date.now() < until); await delay(50); }
      assert.deepEqual(await cache.get(key), { original: true });
      await deadline(cache.del(key));
      assert.equal(await cache.get(key), undefined);
    });
    await queueFailureChecks(connection, proxied, proxy, observer);
    await ready(client);
    await outboxFailureChecks(db, redis, proxy, client);
    await check('shutdown-during-redis-blackhole', async () => {
      proxy.setFault('drop-replies');
      await deadline(Promise.resolve().then(() => redis.onApplicationShutdown()));
      await deadline(manager.disconnect());
    });
    proxy.setFault('pass');
    await verifyIsolatedEnvironment();
    console.log(JSON.stringify({ event: 'redis-failure-evidence', checks: evidence }));
  } finally {
    client.disconnect(); observer.disconnect();
    proxy.setFault('pass');
    await proxy.close();
    const cleanup = await Promise.allSettled([manager.disconnect(), app?.close(), db.$disconnect()]);
    assert(cleanup.every(result => result.status === 'fulfilled'), '本轮客户端或测试HTTP清理失败');
  }
}

async function queueReady(queue: Queue) {
  const until = Date.now() + 8000;
  for (;;) {
    try { const client = await deadline(queue.waitUntilReady()); await deadline(client.hget(queue.keys.meta, 'version')); return; } catch { /* 仅等待后台连接恢复。 */ }
    assert(Date.now() < until, '本轮队列未恢复');
    await delay(50);
  }
}
async function queueFailureChecks(connection: RedisConnectionOptions, proxied: RedisConnectionOptions, proxy: RedisFaultProxy, observerClient: Redis) {
  const name = 'fault-' + randomUUID();
  const observer = new Queue(name, { connection });
  observer.on('error', () => undefined);
  proxy.setFault('disconnected');
  const queue = new BoundedRedisQueue(name, { connection: proxied });
  queue.on('error', () => undefined);
  let worker: ReconnectRedisWorker | undefined;
  const slowEntered = deferred(), slowRelease = deferred(), staleRelease = deferred(), lateRelease = deferred();
  let slowCompleted = false;
  let processed = 0;
  try {
    await check('queue-initially-offline-does-not-enqueue-after-recovery', async () => {
      await rejectsWithin(queue.add('cold', {}, { jobId: 'cold' }));
      proxy.setFault('pass'); await queueReady(queue);
      assert.equal(await observer.getJob('cold'), undefined);
    });
    await check('queue-reply-loss-and-explicit-replay-use-one-job', async () => {
      proxy.setFault('drop-replies');
      await rejectsWithin(queue.add('normal', {}, { jobId: 'reply-lost' }));
      assert(await observer.getJob('reply-lost'));
      proxy.setFault('pass'); await queueReady(queue);
      await queue.add('normal', {}, { jobId: 'reply-lost' });
      assert.equal(await observer.count(), 1);
    });
    await check('worker-reconnects-and-consumes-after-redis-recovery', async () => {
      proxy.setFault('disconnected');
      worker = new ReconnectRedisWorker(name, async job => {
        processed += 1;
        if (job.name === 'slow') { slowEntered.resolve(); await slowRelease.promise; slowCompleted = true; }
      }, { connection: proxied });
      worker.on('error', () => undefined);
      await delay(REDIS_COMMAND_TIMEOUT_MS + 150);
      proxy.setFault('pass'); await queueReady(queue);
      const until = Date.now() + 8000;
      while (await (await observer.getJob('reply-lost'))!.getState() !== 'completed') {
        assert(Date.now() < until, '恢复后 Worker 未完成任务'); await delay(50);
      }
      assert.equal(processed, 1);
    });
    await check('healthy-slow-worker-shutdown-waits-for-completion', async () => {
      await queue.add('slow', {}, { jobId: 'slow' });
      await deadline(slowEntered.promise);
      let closed = false;
      const closing = worker!.close().then(() => { closed = true; });
      try {
        await delay(REDIS_COMMAND_TIMEOUT_MS + 250);
        assert.equal(closed, false);
        assert.equal(slowCompleted, false);
      } finally { slowRelease.resolve(); }
      await deadline(closing);
      assert.equal(slowCompleted, true);
      assert.equal(await (await observer.getJob('slow'))!.getState(), 'completed');
      worker = undefined;
    });
    await check('worker-close-detects-stale-connection-and-awaits-active-handler', async () => {
      const entered = deferred(), release = staleRelease;
      let completed = false, closed = false;
      worker = new ReconnectRedisWorker(name, async () => {
        entered.resolve(); await release.promise; completed = true;
      }, { connection: proxied });
      await deadline(worker.waitUntilReady());
      await queue.add('stale-connection', {}, { jobId: 'stale-connection' });
      await deadline(entered.promise);
      // 现有连接已僵死，但同目标新连接健康；必须探测真正等待中的主连接。
      proxy.dropRepliesForExistingConnections();
      const freshProbe = createRequestRedis(proxied);
      try { await ready(freshProbe); } finally { freshProbe.disconnect(); }
      const closing = worker.close().then(() => { closed = true; });
      try {
        await delay(REDIS_COMMAND_TIMEOUT_MS + 250);
        assert.equal(closed, false); assert.equal(completed, false);
      } finally { release.resolve(); }
      await deadline(closing);
      assert.equal(completed, true);
      assert.equal(await (await observer.getJob('stale-connection'))!.getState(), 'active');
      worker = undefined;
      proxy.setFault('pass'); await queueReady(queue);
    });
    await check('worker-shutdown-detects-redis-failure-after-initial-healthy-ping', async () => {
      const entered = deferred();
      let completed = false;
      worker = new ReconnectRedisWorker(name, async () => {
        entered.resolve(); await lateRelease.promise; completed = true;
      }, { connection: proxied });
      await deadline(worker.waitUntilReady());
      await queue.add('late-fault', {}, { jobId: 'late-fault' });
      await deadline(entered.promise);
      const pingCount = async () => Number(/cmdstat_ping:calls=(\d+)/.exec(await observerClient.info('commandstats'))?.[1] ?? 0);
      const before = await pingCount();
      const closing = worker.close();
      const until = Date.now() + WAIT_MS;
      while (await pingCount() === before) { assert(Date.now() < until); await delay(20); }
      await delay(100);
      proxy.setFault('drop-requests');
      lateRelease.resolve();
      await deadline(closing);
      assert.equal(completed, true);
      assert.equal(await (await observer.getJob('late-fault'))!.getState(), 'active');
      worker = undefined;
      proxy.setFault('pass'); await queueReady(queue);
    });
    await check('idle-worker-and-queue-close-during-redis-blackhole', async () => {
      worker = new ReconnectRedisWorker(name, async () => undefined, { connection: proxied });
      worker.on('error', () => undefined);
      await deadline(worker.waitUntilReady());
      proxy.setFault('drop-requests');
      await deadline(worker.close()); worker = undefined;
      await deadline(queue.close());
    });
    await check('worker-initialization-blackhole-does-not-block-shutdown', async () => {
      worker = new ReconnectRedisWorker(name, async () => undefined, { connection: proxied });
      await delay(50);
      await deadline(worker.close()); worker = undefined;
    });
  } finally {
    slowRelease.resolve(); staleRelease.resolve(); lateRelease.resolve(); proxy.setFault('pass'); proxy.disconnect();
    const cleanup = await Promise.allSettled([worker?.close(), queue.close(), observer.close()]);
    assert(cleanup.every(result => result.status === 'fulfilled'), '本轮队列客户端清理失败');
  }
}

async function outboxFailureChecks(db: PrismaClient, redis: RedisService, proxy: RedisFaultProxy, client: Redis) {
  const prisma = db as PrismaService;
  const outbox = new OutboxService();
  const events = new EventEmitter2();
  const dispatcher = new OutboxDispatcher(prisma, events);
  const recipient = await db.user.create({ data: { username: 'fault-' + randomUUID(), email: randomUUID() + '@fault.invalid', password: 'unusable-isolated-fixture' } });
  const pushes = new BoundedRedisQueue('fault-push-' + randomUUID(), { connection: {
    host: client.options.host, port: client.options.port, db: client.options.db, password: client.options.password,
  } });
  pushes.on('error', () => undefined);
  await queueReady(pushes);
  const delivery = new NotificationDeliveryService(prisma, new MobilePushProducer(pushes),
    new NotificationEligibilityService(prisma, new ThreadAccessService(prisma)));
  const firstId = randomUUID(), secondId = randomUUID();
  const prefix = 'redis-fault:' + randomUUID();
  const gate = deferred(), entered = deferred();
  let releaseNotification = false;
  let firstAttempts = 0;
  events.on('thread.unliked', async (payload: { eventId: string }) => {
    if (payload.eventId === firstId) {
      firstAttempts += 1;
      await redis.hset(prefix, 'projection', 1);
    }
  });
  events.on('thread.unliked', async (payload: { eventId: string }) => {
    if (payload.eventId === firstId && !releaseNotification) { entered.resolve(); await gate.promise; }
    await delivery.deliver({ type: 'system', recipients: [recipient.id], content: '隔离故障通知', eventKey: prefix + ':' + payload.eventId });
  });
  const first = await outbox.enqueue(prisma, { eventType: 'thread.unliked', aggregateType: 'thread', eventKey: prefix + ':first', payload: { eventId: firstId, threadId: prefix } });
  const second = await outbox.enqueue(prisma, { eventType: 'thread.unliked', aggregateType: 'thread', eventKey: prefix + ':second', payload: { eventId: secondId, threadId: prefix } });
  await db.domainOutbox.update({ where: { id: first.id }, data: { createdAt: new Date('2000-01-01T00:00:00Z') } });
  await db.domainOutbox.update({ where: { id: second.id }, data: { createdAt: new Date('2000-01-01T00:00:01Z') } });
  // 让测试只领取自己的事件；其它suite留下的未投递样本不参与本故障窗口。
  const pending = await db.domainOutbox.findMany({ where: { processedAt: null, id: { notIn: [first.id, second.id] } }, select: { id: true, availableAt: true } });
  await db.domainOutbox.updateMany({ where: { id: { in: pending.map(row => row.id) } }, data: { availableAt: new Date(Date.now() + 3600000) } });
  try {
    await check('outbox-awaits-all-listeners-before-retry-and-continues', async () => {
      proxy.setFault('drop-replies');
      let settled = false;
      const dispatch = dispatcher.dispatch().finally(() => { settled = true; });
      try {
        await deadline(entered.promise);
        await delay(REDIS_COMMAND_TIMEOUT_MS + 250);
        assert.equal(settled, false, '兄弟监听器未结束时不得完成投递');
        const waiting = await db.domainOutbox.findUniqueOrThrow({ where: { id: first.id } });
        assert.equal(waiting.processedAt, null);
        assert.equal(waiting.lastError, null, '兄弟监听器未结束时不得提前安排重试');
        await dispatcher.dispatch();
        assert.equal(firstAttempts, 1);
      } finally { releaseNotification = true; gate.resolve(); }
      await deadline(dispatch);
      assert.equal((await db.domainOutbox.findUniqueOrThrow({ where: { id: first.id } })).processedAt, null);
      assert.notEqual((await db.domainOutbox.findUniqueOrThrow({ where: { id: second.id } })).processedAt, null);
      assert.equal(await db.notification.count({ where: { userId: recipient.id } }), 2);
      proxy.setFault('pass'); await ready(client);
      await db.domainOutbox.update({ where: { id: first.id }, data: { availableAt: new Date(0) } });
      await deadline(dispatcher.dispatch());
      assert.notEqual((await db.domainOutbox.findUniqueOrThrow({ where: { id: first.id } })).processedAt, null);
      assert.equal(await db.notification.count({ where: { userId: recipient.id } }), 2);
      assert.equal(firstAttempts, 2);
    });
    await check('outbox-old-claim-cannot-ack-newer-attempt', async () => {
      const oldEvents = new EventEmitter2(), newerEvents = new EventEmitter2();
      const oldDispatcher = new OutboxDispatcher(prisma, oldEvents);
      const newerDispatcher = new OutboxDispatcher(prisma, newerEvents);
      const held = deferred(), release = deferred();
      let newerFails = true;
      oldEvents.on('thread.unliked', async () => { held.resolve(); await release.promise; });
      newerEvents.on('thread.unliked', async () => { if (newerFails) throw new Error('isolated_retry'); });
      const row = await outbox.enqueue(prisma, { eventType: 'thread.unliked', aggregateType: 'thread', eventKey: prefix + ':lease', payload: { eventId: randomUUID(), threadId: prefix } });
      const oldDispatch = oldDispatcher.dispatch();
      try {
        await deadline(held.promise);
        // 仅在本轮合成记录上把租约推进为到期，再由第二个真实dispatcher领取。
        await db.domainOutbox.update({ where: { id: row.id }, data: { availableAt: new Date(0) } });
        await deadline(newerDispatcher.dispatch());
        const newer = await db.domainOutbox.findUniqueOrThrow({ where: { id: row.id } });
        assert.equal(newer.attempts, 2);
        assert.notEqual(newer.lastError, null);
        release.resolve(); await deadline(oldDispatch);
        const afterOld = await db.domainOutbox.findUniqueOrThrow({ where: { id: row.id } });
        assert.equal(afterOld.processedAt, null);
        assert.equal(afterOld.attempts, 2);
        assert.equal(afterOld.lastError, newer.lastError);
        assert.equal(afterOld.availableAt.getTime(), newer.availableAt.getTime());
        newerFails = false;
        await db.domainOutbox.update({ where: { id: row.id }, data: { availableAt: new Date(0) } });
        await deadline(newerDispatcher.dispatch());
        assert.notEqual((await db.domainOutbox.findUniqueOrThrow({ where: { id: row.id } })).processedAt, null);
      } finally {
        release.resolve();
        await Promise.all([oldDispatcher.beforeApplicationShutdown(), newerDispatcher.beforeApplicationShutdown(), oldDispatch]);
      }
    });
    await check('outbox-shutdown-completes-after-redis-failure', async () => {
      const third = await outbox.enqueue(prisma, { eventType: 'thread.unliked', aggregateType: 'thread', eventKey: prefix + ':third', payload: { eventId: firstId, threadId: prefix } });
      proxy.setFault('drop-replies');
      const dispatch = dispatcher.dispatch();
      await delay(100);
      await deadline(dispatcher.beforeApplicationShutdown());
      await deadline(dispatch);
      assert.equal((await db.domainOutbox.findUniqueOrThrow({ where: { id: third.id } })).processedAt, null);
      assert.equal(await db.notification.count({ where: { userId: recipient.id } }), 2);
    });
  } finally {
    gate.resolve(); proxy.setFault('pass');
    await dispatcher.beforeApplicationShutdown();
    await pushes.close();
    for (const row of pending) await db.domainOutbox.update({ where: { id: row.id }, data: { availableAt: row.availableAt } });
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
