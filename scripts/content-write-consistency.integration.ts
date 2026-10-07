import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { lockInteractionUsers, assertInteractionAllowed } from '../src/access/block-visibility.where';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { ThreadAccessService } from '../src/access/thread-access.service';
import { PostingPolicyService } from '../src/access/posting-policy.service';
import { BlockFilterService } from '../src/access/block-filter.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MentionsService } from '../src/mentions/mentions.service';
import { IdentityProjectionService } from '../src/thread-identities/identity-projection.service';
import { ThreadIdentitiesService } from '../src/thread-identities/thread-identities.service';
import { MediaReferenceService } from '../src/media/media-reference.service';
import { StickerContentService } from '../src/stickers/sticker-content.service';
import { DiceService } from '../src/dice/dice.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { SubthreadsService } from '../src/subthreads/subthreads.service';
import { ThreadsService } from '../src/threads/threads.service';
import { ThreadAggregateService } from '../src/threads/thread-aggregate.service';
import { ThreadMembersService } from '../src/threads/thread-members.service';
import { ThreadTagsService } from '../src/threads/thread-tags.service';
import { ThreadCategoriesService } from '../src/taxonomy/thread-categories.service';
import { TagsService } from '../src/tags/tags.service';
import { PostsService } from '../src/posts/posts.service';
import { PostMentionEventsService } from '../src/posts/post-mention-events.service';
import { PostPinService } from '../src/posts/post-pin.service';

// runner 停止后台 API 后执行本 suite；写入角色仍限定为该独立集群的 wenyousite_app。
const appUrl = new URL(process.env.BOOKMARK_COUNT_TEST_APP_URL!);
const ownerUrl = new URL(process.env.DATABASE_URL!);
assert.equal(appUrl.username, 'wenyousite_app');
assert.equal(appUrl.host + appUrl.pathname, ownerUrl.host + ownerUrl.pathname);
const db = new PrismaClient({ datasourceUrl: appUrl.toString(), log: [] });
const prisma = db as PrismaService;
const events = new EventEmitter2();
const access = new ThreadAccessService(prisma);
const media = new MediaReferenceService(prisma);
const identities = new ThreadIdentitiesService(prisma, access, media);
const mentions = new MentionsService(prisma, access, new BlockFilterService(prisma), new IdentityProjectionService(prisma));
const stickers = new StickerContentService(prisma);
const outbox = new OutboxService();
const dice = new DiceService();
const policy = new PostingPolicyService(prisma);
const categories = new ThreadCategoriesService(prisma);
// 缓存/查询适配器不参与这里验证的事务；事件仅持久化，不向真实消费者投递。
const cache = { buildKey: (...parts: string[]) => parts.join(':'), del: async () => undefined };
const tags = new TagsService(prisma, events, cache as never);
const redis = { zadd: async () => 1, hset: async () => 1 };
const members = new ThreadMembersService(prisma, access, outbox);
const subs = new SubthreadsService(prisma, access, events, dice, outbox, stickers, media, mentions, identities);
const aggregate = new ThreadAggregateService(prisma, access, dice, outbox, events, redis as never, mentions, stickers, categories, media, policy, identities);
const pins = new PostPinService(prisma, access);
const posts = new PostsService(prisma, events, access, new PostMentionEventsService(mentions, outbox), dice, policy, {} as never, outbox, stickers, media, pins, identities);
const threadTags = new ThreadTagsService(prisma, tags, access);
const threads = new ThreadsService(prisma, tags, access, events, redis as never, dice, {} as never, {} as never, outbox, stickers, categories, media, {} as never, {} as never, policy, mentions, identities);

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('并发屏障超时')), 4000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function fixture(visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC', published = true) {
  const suffix = randomBytes(5).toString('hex');
  const users = await Promise.all(['owner', 'actor', 'target'].map(prefix => db.user.create({ data: {
    username: prefix + suffix, email: prefix + suffix + '@e2e.invalid', password: 'unusable-isolated-fixture',
  } })));
  const [owner, actor, target] = users;
  const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
  const thread = await db.thread.create({ data: { ownerId: owner.id, title: '事务隔离主题', category: category.slug, published, visibility,
    members: { create: users.map((user, index) => ({ userId: user.id, role: index === 0 ? 'OWNER' : index === 1 ? 'COLLABORATOR' : 'PARTICIPANT', playerMarked: index < 2 })) } } });
  const sub = await db.subthread.create({ data: { threadId: thread.id, title: '默认子贴', sortOrder: 0 } });
  const extra = await db.subthread.create({ data: { threadId: thread.id, title: '其他子贴', sortOrder: 1 } });
  const last = await db.subthread.create({ data: { threadId: thread.id, title: '第三子贴', sortOrder: 2 } });
  await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
  const body = await db.post.create({ data: { threadId: thread.id, subthreadId: sub.id, kind: 'BODY', authorId: owner.id, content: '原正文' } });
  const floor = await db.post.create({ data: { threadId: thread.id, subthreadId: sub.id, kind: 'FLOOR', authorId: owner.id, content: '原楼层', floorNumber: 1 } });
  const asset = await db.media.create({ data: { userId: actor.id, url: 'https://fixture.invalid/' + suffix + '.webp', key: suffix, status: 'COMPLETED', purpose: 'RICH_CONTENT', orphanedAt: new Date() } });
  const tag = await db.topicTag.create({ data: { name: '隔离' + suffix } });
  await db.threadTopicTag.create({ data: { threadId: thread.id, tagId: tag.id } });
  const content = `有效正文 @${target.username} ![图](${asset.url})`;
  return { owner, actor, target, thread, sub, extra, last, body, floor, asset, tag, content };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture) {
  const threadId = f.thread.id;
  return Promise.all([
    db.thread.findUnique({ where: { id: threadId } }),
    db.subthread.findMany({ where: { threadId }, orderBy: { id: 'asc' } }),
    db.post.findMany({ where: { threadId }, orderBy: { id: 'asc' } }),
    db.postMedia.findMany({ where: { post: { threadId } }, orderBy: [{ postId: 'asc' }, { mediaId: 'asc' }] }),
    db.postMention.findMany({ where: { post: { threadId } }, orderBy: { id: 'asc' } }),
    db.domainOutbox.findMany({ where: { payload: { path: ['threadId'], equals: threadId } }, orderBy: { id: 'asc' } }),
    db.threadTopicTag.findMany({ where: { threadId }, orderBy: { tagId: 'asc' } }),
    db.media.findUnique({ where: { id: f.asset.id } }),
  ]);
}
const operations: Record<string, (f: Fixture) => Promise<unknown>> = {
  'subthread.create': f => subs.create(f.thread.id, { title: '新子贴', content: f.content, clientRequestId: randomUUID() }, f.actor.id),
  'aggregate.save': f => aggregate.save(f.thread.id, { version: 1, defaultSubthreadVersion: 1, bodyVersion: 1, title: '新标题', content: f.content, tagNames: [] }, f.actor.id),
  'thread.update': f => threads.update(f.thread.id, { version: 1, title: '新标题' }, f.actor.id),
  'tag.add': f => threadTags.add(f.thread.id, '增加' + randomBytes(4).toString('hex'), f.actor.id),
  'tag.remove': f => threadTags.remove(f.thread.id, f.tag.id, f.actor.id),
  'post.pin': f => pins.pin(f.floor.id, f.actor.id),
  'post.unpin': f => pins.unpin(f.floor.id, f.actor.id),
  'body.create': f => posts.upsertBody(f.extra.id, f.content, undefined, f.actor.id),
  'body.update': f => posts.upsertBody(f.sub.id, f.content, 1, f.actor.id),
  'post.remove': f => posts.remove(f.floor.id, f.actor.id),
  'subthread.reorder': f => subs.reorder(f.thread.id, [f.sub.id, f.last.id, f.extra.id], f.actor.id),
  'subthread.update': f => subs.update(f.extra.id, { version: 1, title: '修改子贴' }, f.actor.id),
  'subthread.remove': f => subs.remove(f.extra.id, f.actor.id),
  'member.update': f => members.updateMember(f.thread.id, f.target.id, { playerMarked: true }, f.actor.id),
};
async function revokeFirst(f: Fixture, operation: (f: Fixture) => Promise<unknown>) {
  const entered = deferred(), resume = deferred();
  const original = access.assertCanManage.bind(access);
  access.assertCanManage = async (...args: Parameters<typeof original>) => {
    const member = await original(...args);
    if (args[1] === f.actor.id && args[2] === undefined) { entered.resolve(); await resume.promise; }
    return member;
  };
  const pending = operation(f).then(() => ({ status: 200 }), error => ({ status: error.status }));
  try {
    await bounded(entered.promise);
    await members.updateMember(f.thread.id, f.actor.id, { role: 'PARTICIPANT', playerMarked: false }, f.owner.id);
    const before = await snapshot(f);
    resume.resolve();
    assert.equal((await bounded(pending)).status, 403);
    assert.deepEqual(await snapshot(f), before, '拒绝必须没有内容、媒体、提及、标签或 Outbox 残留');
    assert.equal((await db.threadMember.findUniqueOrThrow({ where: { threadId_userId: { threadId: f.thread.id, userId: f.target.id } } })).playerMarked, false);
  } finally { resume.resolve(); access.assertCanManage = original; await pending; }
}
async function writeFirst(f: Fixture, operation: (f: Fixture) => Promise<unknown>) {
  const locked = deferred(), resume = deferred(), revokerPid = deferred<number>();
  const original = access.lockManagement.bind(access), originalInteraction = access.lockInteraction.bind(access);
  access.lockManagement = async (...args: Parameters<typeof original>) => {
    const member = await original(...args);
    if (args[2] === f.actor.id) { locked.resolve(); await resume.promise; }
    return member;
  };
  access.lockInteraction = async (...args: Parameters<typeof originalInteraction>) => {
    if (args[2] === f.owner.id) {
      const [row] = await args[0].$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      revokerPid.resolve(row.pid);
    }
    return originalInteraction(...args);
  };
  const pending = operation(f);
  let revoke: Promise<unknown> | undefined;
  try {
    await bounded(locked.promise);
    revoke = members.updateMember(f.thread.id, f.actor.id, { role: 'PARTICIPANT' }, f.owner.id);
    const pid = await bounded(revokerPid.promise);
    await bounded((async () => {
      const deadline = Date.now() + 3500;
      while (Date.now() < deadline) {
        const [row] = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::integer)) > 0 AS waiting`;
        if (row.waiting) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('撤权事务没有按预期等待写入锁');
    })());
    resume.resolve();
    await pending; await revoke;
    await assert.rejects(access.assertCanManage(f.thread.id, f.actor.id), (error: { status?: number }) => error.status === 403);
  } finally {
    resume.resolve(); access.lockManagement = original; access.lockInteraction = originalInteraction;
    await Promise.allSettled([pending, ...(revoke ? [revoke] : [])]);
  }
}
async function currentPlayerSnapshot() {
  const f = await fixture();
  const entered = deferred(), resume = deferred();
  const original = access.assertCanManage.bind(access);
  access.assertCanManage = async (...args: Parameters<typeof original>) => {
    const member = await original(...args);
    if (args[1] === f.actor.id && args[2] === undefined) { entered.resolve(); await resume.promise; }
    return member;
  };
  const pending = subs.create(f.thread.id, { title: '最新权限快照', content: f.content }, f.actor.id);
  try {
    await bounded(entered.promise);
    await members.updateMember(f.thread.id, f.actor.id, { playerMarked: false }, f.owner.id);
    resume.resolve();
    const result = await pending;
    const event = await db.domainOutbox.findFirstOrThrow({ where: { eventType: 'post.created', payload: { path: ['subthreadId'], equals: result.id } } });
    assert.equal((event.payload as Prisma.JsonObject).authorRole, 'COLLABORATOR');
    assert.equal((event.payload as Prisma.JsonObject).authorPlayerMarked, false);
  } finally { resume.resolve(); access.assertCanManage = original; await pending; }
}

async function usageRollback(kind: string) {
  const publishing = kind.endsWith('publish');
  const f = await fixture('PUBLIC', !publishing);
  const suffix = randomBytes(8).toString('hex');
  const asset = await db.stickerAsset.create({ data: { url: 'https://fixture.invalid/' + suffix + '.webp', key: suffix, thumbnailUrl: 'https://fixture.invalid/' + suffix + '-thumb.webp', thumbnailKey: suffix + '-thumb', contentHash: suffix, size: 1, width: 1, height: 1 } });
  await db.userSticker.create({ data: { userId: f.owner.id, assetId: asset.id } });
  await db.media.update({ where: { id: f.asset.id }, data: { userId: f.owner.id } });
  const content = f.content + ' ' + stickers.markdown(asset);
  const key = randomUUID();
  if (publishing) await db.post.update({ where: { id: f.body.id }, data: { content } });
  const invoke = () => {
    switch (kind) {
      case 'post.create': return posts.create(f.sub.id, { content, clientRequestId: key }, f.owner.id);
      case 'post.update': return posts.update(f.floor.id, { content, version: 1 }, f.owner.id);
      case 'body.create': return posts.upsertBody(f.extra.id, content, undefined, f.owner.id);
      case 'body.update': return posts.upsertBody(f.sub.id, content, 1, f.owner.id);
      case 'subthread.create': return subs.create(f.thread.id, { title: '表情子贴', content, clientRequestId: key }, f.owner.id);
      case 'aggregate.save': return aggregate.save(f.thread.id, { version: 1, defaultSubthreadVersion: 1, bodyVersion: 1, content, tagNames: [] }, f.owner.id);
      case 'aggregate.publish': return aggregate.save(f.thread.id, { version: 1, defaultSubthreadVersion: 1, bodyVersion: 1, content, tagNames: [], published: true }, f.owner.id);
      case 'thread.publish': return threads.update(f.thread.id, { version: 1, published: true }, f.owner.id);
      default: throw new Error('未知回归用例');
    }
  };
  const before = await snapshot(f);
  const original = stickers.recordUsage.bind(stickers);
  let reached = false;
  stickers.recordUsage = async (userId, ids, tx) => {
    assert(tx && tx !== prisma, '使用记录必须使用内容事务');
    await original(userId, ids, tx);
    if (ids.includes(asset.id)) { reached = true; throw new Error('injected-usage-failure'); }
  };
  try { await assert.rejects(invoke(), { message: 'injected-usage-failure' }); }
  finally { stickers.recordUsage = original; }
  assert(reached, '故障必须覆盖实际非空表情使用写入');
  assert.deepEqual(await snapshot(f), before, '表情写入失败必须回滚内容和关联');
  const favorite = () => db.userSticker.findUniqueOrThrow({ where: { userId_assetId: { userId: f.owner.id, assetId: asset.id } } });
  assert.equal((await favorite()).lastUsedAt, null);
  const result = await invoke();
  assert((await favorite()).lastUsedAt);
  if (kind === 'post.create' || kind === 'subthread.create') {
    const committed = await snapshot(f); const lastUsedAt = (await favorite()).lastUsedAt;
    const replay = await invoke();
    assert.equal((replay as { id: string }).id, (result as { id: string }).id);
    assert.deepEqual(await snapshot(f), committed, '幂等重放不重复内容、事件或关联');
    assert.deepEqual((await favorite()).lastUsedAt, lastUsedAt);
  }
}
async function waitForUserLock(pid: number) {
  await bounded((async () => {
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::integer)) > 0 AS waiting`;
      if (row.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('用户写入没有按预期等待互动锁');
  })());
}

/** 通知外键只需 KEY SHARE，不能与互动的用户互斥锁组成反向锁环。 */
async function notificationForeignKeyCompatibility() {
  const f = await fixture();
  const [sender, recipient] = [f.owner.id, f.actor.id].sort();
  const foreignKeyHeld = deferred(), insertNotification = deferred(), usersHeld = deferred(), commitContent = deferred();
  const eventKey = 'lock-compatibility:' + randomUUID();
  const notification = db.$transaction(async tx => {
    // 固定通知检查两个用户外键之间的时序，不依赖随机 ID 或负载碰巧触发死锁。
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${recipient} FOR KEY SHARE`;
    foreignKeyHeld.resolve(); await insertNotification.promise;
    const delivery = new NotificationDeliveryService(tx as PrismaService, { enqueue: async () => undefined } as never,
      { filterRecipients: async () => [recipient] } as never);
    await delivery.deliver({ type: 'reply', recipients: [recipient], fromUserId: sender,
      threadId: f.thread.id, postId: f.floor.id, content: '隔离锁兼容通知', eventKey });
  }, { timeout: 15000 });
  let content: Promise<unknown> | undefined;
  try {
    await bounded(foreignKeyHeld.promise);
    content = db.$transaction(async tx => {
      await lockInteractionUsers(tx, [recipient, sender]);
      await tx.post.create({ data: { threadId: f.thread.id, subthreadId: f.sub.id, authorId: sender,
        kind: 'FLOOR', floorNumber: 2, content: '隔离锁兼容正文' } });
      usersHeld.resolve(); await commitContent.promise;
    }, { timeout: 15000 });
    await bounded(usersHeld.promise);
    insertNotification.resolve();
    // 通知真实 INSERT 必须在互动仍持锁时完成；不是先释放互动锁让测试通过。
    await bounded(notification);
    commitContent.resolve(); await content;
    assert.equal(await db.notification.count({ where: { eventKey: eventKey + ':' + recipient } }), 1);
  } finally {
    insertNotification.resolve(); commitContent.resolve();
    await Promise.allSettled([notification, ...(content ? [content] : [])]);
  }
}

/** 减弱到不修改主键的锁后，拉黑互斥和账号删除/键更新的保护必须保留。 */
async function interactionLockExclusion() {
  const f = await fixture();
  const locked = deferred(), resume = deferred(), waiterPid = deferred<number>();
  const blocking = db.$transaction(async tx => {
    await lockInteractionUsers(tx, [f.owner.id, f.actor.id]);
    await tx.userBlock.create({ data: { blockerId: f.owner.id, blockedId: f.actor.id } });
    locked.resolve(); await resume.promise;
  }, { timeout: 15000 });
  let interaction: Promise<unknown> | undefined;
  try {
    await bounded(locked.promise);
    interaction = db.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      waiterPid.resolve(row.pid);
      await assertInteractionAllowed(tx, f.actor.id, [f.owner.id]);
    }, { timeout: 15000 });
    await waitForUserLock(await bounded(waiterPid.promise));
    resume.resolve(); await blocking;
    await assert.rejects(interaction, (error: { status?: number }) => error.status === 403);
  } finally { resume.resolve(); await Promise.allSettled([blocking, ...(interaction ? [interaction] : [])]); }

  for (const kind of ['delete', 'key-update'] as const) {
    const suffix = randomBytes(8).toString('hex');
    const user = await db.user.create({ data: { username: 'lock' + suffix, email: suffix + '@e2e.invalid', password: 'isolated' } });
    const held = deferred(), release = deferred(), pid = deferred<number>();
    const holder = db.$transaction(async tx => {
      await lockInteractionUsers(tx, [user.id]); held.resolve(); await release.promise;
    }, { timeout: 15000 });
    let mutation: Promise<unknown> | undefined;
    try {
      await bounded(held.promise);
      mutation = db.$transaction(async tx => {
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        pid.resolve(row.pid);
        return kind === 'delete' ? tx.user.delete({ where: { id: user.id } })
          : tx.user.update({ where: { id: user.id }, data: { email: 'changed' + suffix + '@e2e.invalid' } });
      }, { timeout: 15000 });
      await waitForUserLock(await bounded(pid.promise));
      release.resolve(); await holder; await mutation;
      const stored = await db.user.findUnique({ where: { id: user.id } });
      if (kind === 'delete') assert.equal(stored, null);
      else assert.equal(stored?.email, 'changed' + suffix + '@e2e.invalid');
    } finally { release.resolve(); await Promise.allSettled([holder, ...(mutation ? [mutation] : [])]); }
  }
}

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.CONTENT_WRITE_CONSISTENCY_TEST_ENV, 'test');
  assert.equal((await db.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`)[0].role, 'wenyousite_app');
  await notificationForeignKeyCompatibility();
  await interactionLockExclusion();
  console.log('通知外键兼容、互动互斥及账号删除/键更新等待通过');
  for (const visibility of ['PUBLIC', 'PRIVATE'] as const) {
    for (const [name, operation] of Object.entries(operations)) {
      const first = await fixture(visibility);
      if (name === 'post.unpin') await db.post.update({ where: { id: first.floor.id }, data: { pinnedAt: new Date() } });
      await revokeFirst(first, operation);
      const second = await fixture(visibility);
      if (name === 'post.unpin') await db.post.update({ where: { id: second.floor.id }, data: { pinnedAt: new Date() } });
      await writeFirst(second, operation);
      console.log('管理并发通过', visibility, name);
    }
  }
  await currentPlayerSnapshot();
  for (const kind of ['post.create', 'post.update', 'body.create', 'body.update', 'subthread.create', 'aggregate.save', 'aggregate.publish', 'thread.publish']) {
    await usageRollback(kind); console.log('表情事务回滚/重试通过', kind);
  }
  await verifyIsolatedEnvironment();
}
main().finally(() => db.$disconnect()).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
