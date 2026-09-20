import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { MediaReferenceService } from '../src/media/media-reference.service';
import type { PrismaService } from '../src/prisma/prisma.service';

export const TARGET = { id: 'cmtt21ub700007qfeleo3j76y', username: 'webe2e' } as const;
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function canonical(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function summarize(rows: Array<{ id: string } & Record<string, unknown>>) {
  return rows.map((row) => {
    const content = row.content ?? row.title;
    return { id: row.id, sha256: digest(row), ...(typeof content === 'string' ? {
      normalizedContentSha256: digest(content.normalize('NFC').replace(/\r\n?/g, '\n')),
      contentLength: [...content].length,
    } : {}) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function snapshot(tx: Prisma.TransactionClient) {
  const databaseIdentity = await tx.$queryRaw<Array<{ database: string; oid: number; address: string | null; port: number | null }>>`
    SELECT current_database() AS database, oid::integer AS oid,
      inet_server_addr()::text AS address, inet_server_port() AS port
    FROM pg_database WHERE datname = current_database()`;
  const identity = await tx.user.findUnique({ where: { id: TARGET.id }, select: { id: true, username: true } });
  ensure(identity?.username === TARGET.username, '目标 ID/username 不匹配');
  const threads = await tx.thread.findMany({ where: { ownerId: TARGET.id }, orderBy: { id: 'asc' } });
  const ids = threads.map((t) => t.id);
  const threadId = { in: ids };
  const posts = await tx.post.findMany({ where: { threadId }, orderBy: { id: 'asc' } });
  const postId = { in: posts.map((p) => p.id) };
  const [subthreads, members, likes, bookmarks, subscriptions, invites, tags, mentions, dice, media, notifications, drafts, wallet, transactions, moments, comments, outsidePosts, pendingEvents] = await Promise.all([
    tx.subthread.findMany({ where: { threadId } }), tx.threadMember.findMany({ where: { threadId } }),
    tx.threadLike.findMany({ where: { threadId } }), tx.userBookmark.findMany({ where: { threadId } }),
    tx.subscription.findMany({ where: { threadId } }), tx.threadInvite.findMany({ where: { threadId } }),
    tx.threadTopicTag.findMany({ where: { threadId } }), tx.postMention.findMany({ where: { postId } }),
    tx.diceRoll.findMany({ where: { postId } }), tx.postMedia.findMany({ where: { postId } }),
    tx.notification.findMany({ where: { OR: [{ threadId }, { postId }] } }),
    tx.draft.findMany({ where: { userId: TARGET.id } }),
    tx.wallet.findUnique({ where: { userId: TARGET.id } }),
    tx.walletTransaction.count({ where: { OR: [{ targetThreadId: threadId }, { targetUserId: TARGET.id }, { senderWallet: { userId: TARGET.id } }, { recipientWallet: { userId: TARGET.id } }] } }),
    tx.moment.count({ where: { authorId: TARGET.id } }), tx.momentComment.count({ where: { authorId: TARGET.id } }),
    tx.post.count({ where: { threadId: { notIn: ids }, OR: [{ authorId: TARGET.id }, { parentPostId: postId }, { replyToPostId: postId }] } }),
    tx.domainOutbox.count({ where: { processedAt: null, OR: [
      { aggregateId: { in: [...ids, ...posts.map((p) => p.id), TARGET.id] } },
      ...ids.map((id) => ({ payload: { path: ['threadId'], equals: id } })),
    ] } }),
  ]);
  const otherUsers = posts.filter((p) => p.authorId !== TARGET.id).length
    + [...members, ...likes, ...bookmarks, ...subscriptions, ...notifications].filter((r) => r.userId !== TARGET.id).length
    + mentions.filter((r) => r.mentionedUserId !== TARGET.id).length;
  ensure(otherUsers === 0, '范围包含其他用户内容或关联，拒绝删除');
  ensure(transactions === 0, '存在交易，拒绝删除');
  ensure(moments === 0 && comments === 0 && drafts.length === 0 && outsidePosts === 0, '存在审计范围外的内容，拒绝删除');
  ensure(pendingEvents === 0, '范围存在未处理 Outbox，等待处理后重新审计');
  const resources = {
    threads: summarize(threads), posts: summarize(posts), subthreads: summarize(subthreads),
    members: summarize(members), likes: summarize(likes), bookmarks: summarize(bookmarks),
    subscriptions: summarize(subscriptions), invites: summarize(invites), tags: summarize(tags),
    mentions: summarize(mentions), dice: summarize(dice), mediaReferences: summarize(media.map((r) => ({ ...r, id: `${r.postId}:${r.mediaId}` }))),
    notifications: summarize(notifications),
  };
  return {
    version: 1, target: TARGET, databaseIdentity, resources,
    counts: { ...Object.fromEntries(Object.entries(resources).map(([k, v]) => [k, v.length])),
      softDeletedThreads: threads.filter((t) => t.deletedAt).length,
      draftThreads: threads.filter((t) => !t.deletedAt && !t.published).length,
      transactions, otherUsers, drafts: drafts.length, moments, comments, outsidePosts, pendingEvents },
    mediaIds: [...new Set(media.map((r) => r.mediaId))].sort(),
    preservedWalletSha256: digest(wallet),
  };
}
export type Manifest = Awaited<ReturnType<typeof snapshot>>;

export async function dryRun(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return snapshot(tx);
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
}

export async function apply(prisma: PrismaClient, manifest: Manifest, sha256: string, backupSha256: string) {
  ensure(digest(manifest) === sha256 && /^[a-f0-9]{64}$/.test(sha256), 'manifest 校验值不匹配');
  ensure(/^[a-f0-9]{64}$/.test(backupSha256), '缺少已验证备份校验值');
  ensure(canonical(manifest.target) === canonical(TARGET) && manifest.version === 1, 'manifest 目标不匹配');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    // 短暂阻止受影响关系写入，覆盖 FK 级联、无 FK 的 Outbox 与新建内容；超时即失败关闭。
    await tx.$executeRaw`LOCK TABLE users, threads, posts, subthreads, thread_members,
      thread_likes, user_bookmarks, subscriptions, thread_invites, thread_topic_tags,
      post_mentions, dice_rolls, post_media, draft_media, drafts, notifications,
      wallets, wallet_transactions, moments, moment_comments, domain_outbox, media,
      moment_images, direct_messages, sticker_imports, audit_logs IN SHARE ROW EXCLUSIVE MODE`;
    const identity = await tx.user.findUnique({ where: { id: TARGET.id }, select: { username: true } });
    ensure(identity?.username === TARGET.username, '目标 ID/username 不匹配');
    const receiptId = `webe2e-cleanup-${sha256}`;
    const receipt = await tx.auditLog.findUnique({ where: { id: receiptId } });
    if (receipt) {
      ensure((receipt.metadata as Record<string, unknown>)?.manifestSha256 === sha256, '完成凭据不匹配');
      ensure(await tx.thread.count({ where: { id: { in: manifest.resources.threads.map((t) => t.id) } } }) === 0, '已完成清理的资源重新出现');
      return { alreadyApplied: true };
    }
    ensure(digest(await snapshot(tx)) === sha256, '资源范围或内容漂移，必须重新 dry-run/备份/审核');
    await tx.thread.deleteMany({ where: { id: { in: manifest.resources.threads.map((t) => t.id) }, ownerId: TARGET.id } });
    const references = new MediaReferenceService(prisma as PrismaService);
    await references.reconcileMediaIds(tx, manifest.mediaIds);
    await tx.auditLog.create({ data: {
      id: receiptId, action: 'CONTENT_HIDDEN', targetType: 'USER', targetId: TARGET.id,
      reason: '受控历史测试内容硬删除；保留账号、钱包与审计',
      metadata: { operation: 'webe2e-hard-delete-v1', manifestSha256: sha256, backupSha256,
        threadIds: manifest.resources.threads.map((t) => t.id), cacheInvalidation: 'pending' },
    } });
    return { alreadyApplied: false };
  }, { timeout: 30_000 });
}

/** 幂等重试；失败时数据库完成凭据保留 pending，重复 apply 只补偿缓存。 */
export async function invalidate(prisma: PrismaClient, redis: Redis, manifest: Manifest, sha256: string) {
  const ids = manifest.resources.threads.map((t) => t.id);
  const batch = redis.multi();
  for (const id of ids) {
    batch.del(`thread:${id}:stats`);
    for (const key of ['threads:by:created', 'threads:by:activity', 'threads:by:participation:v1']) batch.zrem(key, id);
  }
  batch.del('threads:by:participation:v1:ready');
  const result = await batch.exec();
  ensure(result && result.every(([error]) => !error), '缓存失效失败；用原 manifest 重试 apply');
  const id = `webe2e-cleanup-${sha256}`;
  const receipt = await prisma.auditLog.findUniqueOrThrow({ where: { id } });
  await prisma.auditLog.update({ where: { id }, data: {
    metadata: { ...(receipt.metadata as Prisma.JsonObject), cacheInvalidation: 'complete' },
  } });
}
