import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prismaDiagnostics } from '../src/common/prisma-diagnostics';
import { PrismaService } from '../src/prisma/prisma.service';
import { ThreadAggregateService } from '../src/threads/thread-aggregate.service';
import { ThreadAccessService } from '../src/access/thread-access.service';
import { PostingPolicyService } from '../src/access/posting-policy.service';
import { BlockFilterService } from '../src/access/block-filter.service';
import { MentionsService } from '../src/mentions/mentions.service';
import { IdentityProjectionService } from '../src/thread-identities/identity-projection.service';
import { ThreadIdentitiesService } from '../src/thread-identities/thread-identities.service';
import { MediaReferenceService } from '../src/media/media-reference.service';
import { StickerContentService } from '../src/stickers/sticker-content.service';
import { DiceService } from '../src/dice/dice.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { ThreadCategoriesService } from '../src/taxonomy/thread-categories.service';
import { FontReadinessService } from '../src/text-fonts/font-readiness.service';
import { FontStorageService } from '../src/text-fonts/font-storage.service';

const appUrl = new URL(process.env.BOOKMARK_COUNT_TEST_APP_URL!);
const ownerUrl = new URL(process.env.DATABASE_URL!);
assert.equal(appUrl.username, 'wenyousite_app');
assert.equal(appUrl.host + appUrl.pathname, ownerUrl.host + ownerUrl.pathname);
const db = new PrismaClient({ datasourceUrl: appUrl.toString(), log: [] });
const evidence: Array<Record<string, unknown>> = [];
function record(caseName: string, details: Record<string, unknown>) {
  evidence.push({ case: caseName, ...details });
  writeFileSync(
    `/tmp/aggregate-transaction-evidence-${process.env.E2E_RUN_ID}.json`,
    JSON.stringify({ runId: process.env.E2E_RUN_ID, evidence }, null, 2),
    { mode: 0o600 },
  );
}
function service(client = db, readiness?: FontReadinessService, outbox = new OutboxService()) {
  const prisma = client as PrismaService;
  const access = new ThreadAccessService(prisma),
    media = new MediaReferenceService(prisma);
  return new ThreadAggregateService(
    prisma,
    access,
    new DiceService(),
    outbox,
    new EventEmitter2(),
    { zadd: async () => 1, hset: async () => 1 } as never,
    new MentionsService(
      prisma,
      access,
      new BlockFilterService(prisma),
      new IdentityProjectionService(prisma),
    ),
    new StickerContentService(prisma),
    new ThreadCategoriesService(prisma),
    media,
    new PostingPolicyService(prisma),
    new ThreadIdentitiesService(prisma, access, media),
    new ConfigService({ textFonts: { enabled: !!readiness } }),
    readiness,
  );
}
async function fixture() {
  const suffix = randomBytes(8).toString('hex');
  const user = await db.user.create({
    data: {
      username: 'agg' + suffix,
      email: suffix + '@e2e.invalid',
      password: 'unusable-isolated-fixture',
    },
  });
  const category = await db.threadCategoryDefinition.findFirstOrThrow({
    where: { isActive: true },
  });
  const thread = await db.thread.create({
    data: {
      ownerId: user.id,
      title: '隔离草稿',
      category: category.slug,
      published: false,
      members: { create: { userId: user.id, role: 'OWNER', playerMarked: true } },
    },
  });
  const sub = await db.subthread.create({
    data: { threadId: thread.id, title: '隔离草稿', sortOrder: 0 },
  });
  await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
  const body = await db.post.create({
    data: {
      threadId: thread.id,
      subthreadId: sub.id,
      authorId: user.id,
      kind: 'BODY',
      content: '原正文',
    },
  });
  const dto = {
    version: 1,
    defaultSubthreadVersion: 1,
    bodyVersion: 1,
    title: '隔离发布',
    content: '普通正文',
    tagNames: ['agg' + suffix],
    published: true as const,
  };
  return { user, thread, sub, body, dto };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture) {
  return Promise.all([
    db.thread.findUnique({ where: { id: f.thread.id } }),
    db.subthread.findMany({ where: { threadId: f.thread.id }, orderBy: { id: 'asc' } }),
    db.post.findMany({ where: { threadId: f.thread.id }, orderBy: { id: 'asc' } }),
    db.threadTopicTag.findMany({ where: { threadId: f.thread.id } }),
    db.topicTag.findMany({ where: { name: { in: f.dto.tagNames } } }),
    db.domainOutbox.findMany({
      where: { payload: { path: ['threadId'], equals: f.thread.id } },
      orderBy: { id: 'asc' },
    }),
  ]);
}
async function save(s: ThreadAggregateService, f: Fixture) {
  return s.save(f.thread.id, f.dto, f.user.id);
}
async function assertPublished(f: Fixture) {
  assert.equal((await db.thread.findUniqueOrThrow({ where: { id: f.thread.id } })).version, 2);
  assert.equal(
    (await db.post.findUniqueOrThrow({ where: { id: f.body.id } })).content,
    f.dto.content,
  );
  assert.equal(
    await db.domainOutbox.count({ where: { eventKey: 'thread-published:' + f.thread.id } }),
    1,
  );
  await assert.rejects(
    save(service(), f),
    (error: { errorCode?: number }) => error.errorCode === 40002,
  );
  assert.equal(
    await db.domainOutbox.count({ where: { eventKey: 'thread-published:' + f.thread.id } }),
    1,
  );
}
async function poolProbe() {
  const f = await fixture();
  const url = new URL(appUrl);
  url.searchParams.set('connection_limit', '1');
  const single = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const readiness = new FontReadinessService(
    single as PrismaService,
    {
      requireConfigured: () => '/unused-isolated-probe',
      probe: async () => {
        throw new Error('不完整历史导入不得探测对象存储');
      },
    } as unknown as FontStorageService,
  );
  try {
    const start = Date.now();
    await save(service(single, readiness), f);
    record('single-connection-readiness', { saved: true, elapsedMs: Date.now() - start });
    await assertPublished(f);
    assert.equal(
      (await single.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`)[0].lock_timeout,
      '0',
    );
  } finally {
    await single.$disconnect();
  }
}
async function lockProbe() {
  const f = await fixture(),
    before = await snapshot(f);
  let ready!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.user.id} FOR NO KEY UPDATE`;
      ready();
      await held;
    },
    { timeout: 15000 },
  );
  const url = new URL(appUrl);
  url.searchParams.set('application_name', 'aggregate-lock-probe');
  const writer = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  await locked;
  const start = Date.now();
  const pending = save(service(writer), f).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT cardinality(pg_blocking_pids(pid)) > 0 AS waiting FROM pg_stat_activity WHERE application_name = 'aggregate-lock-probe'`;
      if (rows.some((row) => row.waiting)) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiting, '必须先取得实际 PostgreSQL 锁等待证据');
    const error = await pending;
    assert.equal((error as { errorCode?: number })?.errorCode, 40002);
    assert.equal((error as { status?: number })?.status, 409);
    assert.deepEqual(await snapshot(f), before);
    record('held-user-lock', {
      status: 409,
      elapsedMs: Date.now() - start,
      waitingVerified: true,
      rollbackVerified: true,
    });
  } finally {
    release();
    await Promise.allSettled([holder, pending]);
    await writer.$disconnect();
  }
  await save(service(), f);
  await assertPublished(f);
}
async function expiredAfterWrite() {
  const f = await fixture(),
    before = await snapshot(f),
    outbox = new OutboxService();
  const enqueue = outbox.enqueue.bind(outbox);
  // 测试适配器延迟已完成的 PrismaPromise；生产服务仍返回原 PrismaPromise。
  outbox.enqueue = (async (...args: Parameters<typeof enqueue>) => {
    const result = await enqueue(...args);
    if (args[1].eventType === 'thread.published') {
      // 故障注入：在写入与 Outbox 后耗尽真实 Prisma 默认事务预算。
      await new Promise((resolve) => setTimeout(resolve, 5300));
      await (args[0] as Prisma.TransactionClient).$queryRaw`SELECT 1`;
    }
    return result;
  }) as unknown as OutboxService['enqueue'];
  const error: unknown = await save(service(db, undefined, outbox), f).then(
    () => undefined,
    (failure: unknown) => failure,
  );
  assert(error instanceof Prisma.PrismaClientKnownRequestError);
  assert.equal(error.code, 'P2028');
  assert.equal(prismaDiagnostics(error).dbStage, 'outbox');
  assert.deepEqual(await snapshot(f), before);
  await save(service(), f);
  await assertPublished(f);
  record('expired-after-outbox-injection', {
    ...prismaDiagnostics(error),
    rollbackVerified: true,
    retryVerified: true,
  });
}
async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.AGGREGATE_TRANSACTION_TEST_ENV, 'test');
  assert.equal(
    (await db.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`)[0].role,
    'wenyousite_app',
  );
  for (let i = 0; i < 20; i++) {
    const f = await fixture();
    await save(service(), f);
    await assertPublished(f);
  }
  record('ordinary-publish-and-stale-replay', { passed: 20 });
  await poolProbe();
  await lockProbe();
  await expiredAfterWrite();
  await verifyIsolatedEnvironment();
}
main()
  .finally(() => db.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
