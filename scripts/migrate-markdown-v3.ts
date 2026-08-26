import { Prisma, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { DiceService } from '../src/dice/dice.service';
import { reconcilePublishedDice } from '../src/dice/reconcile-published-dice';
import {
  planMarkdownV3Migration,
  staleMentionRelationIds,
} from '../src/common/markdown-v3-migration';
import { findUnsupportedMarkdownFormats } from '../src/common/markdown-content';

const prisma = new PrismaClient();
const dice = new DiceService();
const apply = process.argv.includes('--apply');
const backupConfirmed = process.argv.includes('--backup-confirmed');

function summarize(
  postChanges: ReturnType<typeof planMarkdownV3Migration>,
  draftChanges: ReturnType<typeof planMarkdownV3Migration>,
) {
  const unsupportedTypes: Record<string, number> = {};
  for (const change of [...postChanges, ...draftChanges]) {
    for (const type of change.unsupportedTypes) {
      unsupportedTypes[type] = (unsupportedTypes[type] ?? 0) + 1;
    }
  }
  return {
    mode: apply ? 'apply' : 'dry-run',
    posts: postChanges.length,
    drafts: draftChanges.length,
    unsupportedTypes,
  };
}

async function invalidateContentCaches(): Promise<number> {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    const keys = new Set<string>();
    for (const pattern of ['cache:*', 'keyv:cache:*', 'keyv::cache:*']) {
      let cursor = '0';
      do {
        const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        found.forEach((key) => keys.add(key));
      } while (cursor !== '0');
    }
    if (keys.size > 0) await redis.del(...keys);
    return keys.size;
  } finally {
    redis.disconnect();
  }
}

async function migratePosts(
  tx: Prisma.TransactionClient,
  changes: ReturnType<typeof planMarkdownV3Migration>,
) {
  for (const change of changes) {
    const post = await tx.post.findUniqueOrThrow({
      where: { id: change.id },
      select: {
        diceRolls: { select: { id: true, nodeId: true, notation: true } },
        mentions: {
          select: {
            id: true,
            mentionedUserId: true,
            source: true,
            mentionedUser: { select: { username: true } },
          },
        },
      },
    });
    const parsed = dice.parseContent(change.nextContent);
    const updated = await tx.post.updateMany({
      where: { id: change.id, version: change.version },
      data: { content: parsed.content, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new Error(`帖子 ${change.id} 在迁移期间被并发修改，事务已回滚`);
    }
    await reconcilePublishedDice(tx, dice, change.id, parsed.nodes, post.diceRolls);
    const staleMentionIds = staleMentionRelationIds(
      parsed.content,
      post.mentions.map((mention) => ({
        id: mention.id,
        mentionedUserId: mention.mentionedUserId,
        username: mention.mentionedUser.username,
        source: mention.source,
      })),
    );
    if (staleMentionIds.length > 0) {
      await tx.postMention.deleteMany({ where: { id: { in: staleMentionIds } } });
    }
  }
}

async function main() {
  if (apply && !backupConfirmed) {
    throw new Error('应用迁移前必须先运行 scripts/backup.sh，再追加 --backup-confirmed');
  }
  const [posts, drafts] = await Promise.all([
    prisma.post.findMany({ select: { id: true, content: true, version: true } }),
    prisma.draft.findMany({ select: { id: true, content: true, version: true } }),
  ]);
  const postChanges = planMarkdownV3Migration(posts);
  const draftChanges = planMarkdownV3Migration(drafts);
  console.log(JSON.stringify(summarize(postChanges, draftChanges), null, 2));
  if (!apply) return;

  await prisma.$transaction(async (tx) => {
    await migratePosts(tx, postChanges);
    for (const change of draftChanges) {
      const updated = await tx.draft.updateMany({
        where: { id: change.id, version: change.version },
        data: { content: change.nextContent, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new Error(`草稿 ${change.id} 在迁移期间被并发修改，事务已回滚`);
      }
    }
  }, { timeout: 60_000 });

  const [remainingPosts, remainingDrafts] = await Promise.all([
    prisma.post.findMany({ select: { id: true, content: true } }),
    prisma.draft.findMany({ select: { id: true, content: true } }),
  ]);
  const remaining = [
    ...remainingPosts.map((item) => ({ kind: 'post', ...item })),
    ...remainingDrafts.map((item) => ({ kind: 'draft', ...item })),
  ].filter((item) => findUnsupportedMarkdownFormats(item.content).length > 0);
  if (remaining.length > 0) {
    throw new Error(`迁移后仍有 ${remaining.length} 条正文包含不支持结构`);
  }
  const invalidatedCacheKeys = await invalidateContentCaches();
  console.log(JSON.stringify({ applied: true, remainingUnsupported: 0, invalidatedCacheKeys }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
