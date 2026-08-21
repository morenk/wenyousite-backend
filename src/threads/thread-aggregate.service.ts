import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ThreadAccessService } from '../access/thread-access.service';
import { BusinessException, forbidden, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { hasVisibleMarkdownContent, prepareMarkdownContent } from '../common/markdown-content';
import { truncateMarkdown } from '../common/markdown-truncate';
import {
  attachPlayerCounts,
  authorSelect,
  countMembersAndPosts,
  includeSubthreads,
  mapSubthreadBody,
  notDeleted,
} from '../common/prisma-helpers';
import { DiceService } from '../dice/dice.service';
import { reconcilePublishedDice } from '../dice/reconcile-published-dice';
import { MentionsService } from '../mentions/mentions.service';
import { PostMentionsUpdatedEvent } from '../mentions/mention-events';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SaveThreadAggregateDto } from './dto/save-thread-aggregate.dto';
import { StickerContentService } from '../stickers/sticker-content.service';
import { computeThreadEngagement, computeThreadSmartScore } from './thread-smart-score';
import { ThreadCategoriesService } from '../taxonomy/thread-categories.service';
import { MediaReferenceService } from '../media/media-reference.service';

const ZSET_BY_CREATED = 'threads:by:created';
const ZSET_BY_ACTIVITY = 'threads:by:activity';
const ZSET_BY_SMART = 'threads:by:smart';

interface UpdatedBodySideEffect {
  postId: string;
}

interface PublishedThreadCacheData {
  id: string;
  createdAt: Date;
  viewCount: number;
  tipTotal?: bigint;
  _count?: { posts?: number };
}

/** 主题帖编辑器聚合用例：一个事务保存元数据、默认子贴、正文、标签和发布状态。 */
@Injectable()
export class ThreadAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ThreadAccessService,
    private readonly dice: DiceService,
    private readonly outbox: OutboxService,
    private readonly eventEmitter: EventEmitter2,
    private readonly redis: RedisService,
    private readonly mentions: MentionsService,
    private readonly stickerContent: StickerContentService,
    private readonly categories: ThreadCategoriesService,
    private readonly mediaReferences: MediaReferenceService,
  ) {}

  async save(threadId: string, dto: SaveThreadAggregateDto, userId: string) {
    const manager = await this.access.assertCanManage(threadId, userId);
    if (
      manager.role === 'COLLABORATOR' &&
      (dto.visibility !== undefined || dto.published !== undefined)
    ) {
      throw forbidden('仅楼主可修改可见性或发布主题帖', ErrorCode.NOT_THREAD_OWNER);
    }
    if (dto.published === false) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '已发布主题帖不能撤回为草稿');
    }

    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '主题帖标题不能为空');
    }
    const tagNames = [...new Set(dto.tagNames.map((name) => name.trim()))];
    if (tagNames.some((name) => !name)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '标签名称不能为空');
    }
    const parsedContent = this.dice.parseContent(prepareMarkdownContent(dto.content));
    const content = parsedContent.content;
    const previousBody = await this.prisma.post.findFirst({
      where: {
        threadId,
        kind: 'BODY',
        subthread: { defaultForThread: { is: { id: threadId } } },
        ...notDeleted,
      },
      select: { content: true },
      orderBy: { createdAt: 'asc' },
    });
    const stickerAssetIds = await this.stickerContent.assertContentAllowed(
      userId,
      content,
      previousBody?.content ?? '',
    );

    const result = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
        const current = await tx.thread.findUnique({
          where: { id: threadId, ...notDeleted },
          select: {
            id: true,
            title: true,
            category: true,
            published: true,
            version: true,
            defaultSubthreadId: true,
            defaultSubthread: {
              select: {
                id: true,
                title: true,
                version: true,
                posts: {
                  where: { kind: 'BODY', ...notDeleted },
                  orderBy: { createdAt: 'asc' },
                  take: 1,
                  select: {
                    id: true,
                    content: true,
                    version: true,
                    author: { select: { username: true } },
                    diceRolls: { select: { id: true, nodeId: true, notation: true } },
                  },
                },
              },
            },
          },
        });
        if (!current) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
        if (current.version !== dto.version) this.optimisticLockConflict('主题帖');
        if (!current.defaultSubthread || !current.defaultSubthreadId) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '主题帖缺少默认子贴');
        }
        if (current.defaultSubthread.version !== dto.defaultSubthreadVersion) {
          this.optimisticLockConflict('默认子贴');
        }
        if (dto.published === true && current.published) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '主题帖已发布');
        }

        const effectiveTitle = title ?? current.title ?? '';
        let effectiveCategory = current.category;
        if (dto.category !== undefined) {
          effectiveCategory = await this.categories.assertSelectable(dto.category, tx);
        }
        const publishing = dto.published === true;
        const effectivePublished = current.published || publishing;
        if (publishing) {
          this.assertPublishReadiness(
            effectiveTitle,
            effectiveCategory,
            parsedContent.contentWithoutDice,
          );
          if (dto.category === undefined) {
            await this.categories.assertSelectable(effectiveCategory!, tx);
          }
        } else if (
          effectivePublished &&
          !hasVisibleMarkdownContent(parsedContent.contentWithoutDice)
        ) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '默认子贴正文必须包含可见文字');
        }

        const defaultSubthread = current.defaultSubthread;
        const nextSubthreadTitle = title ?? defaultSubthread.title;
        if (nextSubthreadTitle !== defaultSubthread.title) {
          await tx.subthread.update({
            where: { id: defaultSubthread.id, version: dto.defaultSubthreadVersion, ...notDeleted },
            data: { title: nextSubthreadTitle, version: { increment: 1 } },
          });
        }

        const existingBody = defaultSubthread.posts[0];
        let updatedBody: UpdatedBodySideEffect | undefined;
        let createdPublishedBody:
          | {
              id: string;
              author: { username: string };
              diceRolls: { nodeId: string; notation: string; total: number }[];
            }
          | undefined;
        if (existingBody) {
          if (dto.bodyVersion !== existingBody.version) this.optimisticLockConflict('默认正文');
          if (existingBody.content !== content) {
            const post = await tx.post.update({
              where: { id: existingBody.id, version: dto.bodyVersion, ...notDeleted },
              data: { content, version: { increment: 1 } },
            });
            await this.mediaReferences.syncPostContent(tx, post.id, content);
            if (current.published) {
              await reconcilePublishedDice(
                tx,
                this.dice,
                post.id,
                parsedContent.nodes,
                existingBody.diceRolls,
              );
              await this.syncEditedMentions(tx, {
                postId: post.id,
                version: post.version,
                previousContent: existingBody.content,
                content,
                authorUsername: existingBody.author.username,
                userId,
                threadId,
              });
              updatedBody = {
                postId: post.id,
              };
            }
          }
        } else {
          if (dto.bodyVersion !== undefined) this.optimisticLockConflict('默认正文');
          const hasBody =
            hasVisibleMarkdownContent(parsedContent.contentWithoutDice) ||
            parsedContent.nodes.length > 0;
          if (hasBody) {
            const created = await tx.post.create({
              data: {
                threadId,
                subthreadId: defaultSubthread.id,
                authorId: userId,
                kind: 'BODY',
                content,
              },
              include: { author: { select: { username: true } } },
            });
            await this.mediaReferences.syncPostContent(tx, created.id, content);
            if (current.published) {
              await reconcilePublishedDice(tx, this.dice, created.id, parsedContent.nodes);
              createdPublishedBody = await tx.post.findUniqueOrThrow({
                where: { id: created.id },
                select: {
                  id: true,
                  author: { select: { username: true } },
                  diceRolls: {
                    orderBy: { createdAt: 'asc' },
                    select: { nodeId: true, notation: true, total: true },
                  },
                },
              });
            }
          }
        }

        const existingTags = tagNames.length
          ? await tx.topicTag.findMany({ where: { name: { in: tagNames } } })
          : [];
        if (existingTags.some((tag) => tag.isActive === false)) {
          throw new BusinessException(
            ErrorCode.TAXONOMY_STATE_CONFLICT,
            '所选标签已停用',
            HttpStatus.CONFLICT,
          );
        }
        const existingTagNames = new Set(existingTags.map((tag) => tag.name));
        const missingTagNames = tagNames.filter((name) => !existingTagNames.has(name));
        if (missingTagNames.length > 0) {
          await tx.topicTag.createMany({
            data: missingTagNames.map((name) => ({ name })),
            skipDuplicates: true,
          });
        }
        const tags = tagNames.length
          ? await tx.topicTag.findMany({
              where: { name: { in: tagNames }, isActive: true },
            })
          : [];
        const tagIds = tags.map((tag) => tag.id);
        await tx.threadTopicTag.deleteMany({
          where: {
            threadId,
            ...(tagIds.length ? { tagId: { notIn: tagIds } } : {}),
          },
        });
        if (tagIds.length > 0) {
          await tx.threadTopicTag.createMany({
            data: tagIds.map((tagId) => ({ threadId, tagId })),
            skipDuplicates: true,
          });
        }

        if (publishing) {
          await this.settleDraftPosts(tx, threadId);
        } else if (createdPublishedBody) {
          await this.outbox.enqueue(tx, {
            eventType: 'post.created',
            aggregateType: 'Post',
            aggregateId: createdPublishedBody.id,
            eventKey: `post-created:${createdPublishedBody.id}`,
            payload: {
              postId: createdPublishedBody.id,
              content,
              userId,
              authorUsername: createdPublishedBody.author.username,
              occurredAt: new Date().toISOString(),
              threadId,
              subthreadId: defaultSubthread.id,
              subthreadTitle: nextSubthreadTitle,
              parentPostId: null,
              replyToPostId: null,
              isSubthreadBody: true,
              authorRole: manager.role,
              authorPlayerMarked: manager.playerMarked,
              diceRolls: createdPublishedBody.diceRolls,
            },
          });
        }

        const updated = await tx.thread.update({
          where: { id: threadId, version: dto.version, ...notDeleted },
          data: {
            ...(title !== undefined ? { title } : {}),
            ...(dto.category !== undefined ? { category: effectiveCategory } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
            ...(publishing ? { published: true, publishedAt: new Date() } : {}),
            version: { increment: 1 },
          },
          include: {
            owner: { select: authorSelect },
            ...includeSubthreads(),
            topicTags: { include: { tag: true } },
            ...countMembersAndPosts(),
          },
        });

        if (publishing) {
          await this.outbox.enqueue(tx, {
            eventType: 'thread.published',
            aggregateType: 'Thread',
            aggregateId: threadId,
            eventKey: `thread-published:${threadId}`,
            payload: {
              threadId,
              ownerId: updated.ownerId,
              ownerUsername: updated.owner.username,
              occurredAt: new Date().toISOString(),
            },
          });
        }

        return {
          updated,
          publishing,
          defaultSubthreadId: defaultSubthread.id,
          subthreadTitleChanged: nextSubthreadTitle !== defaultSubthread.title,
          updatedBody,
        };
      })
      .catch((error) => {
        if (error instanceof BusinessException) throw error;
        if ((error as { code?: string })?.code === 'P2025') this.optimisticLockConflict('内容');
        throw error;
      });

    result.updated.subthreads = mapSubthreadBody(result.updated.subthreads);
    await attachPlayerCounts(this.prisma, [result.updated]);
    if (result.publishing) this.initializePublishedThreadCache(result.updated);
    this.eventEmitter.emit('thread.updated', { threadId });
    if (result.subthreadTitleChanged) {
      this.eventEmitter.emit('subthread.updated', {
        threadId,
        subthreadId: result.defaultSubthreadId,
      });
    }
    if (result.updatedBody) {
      this.eventEmitter.emit('post.updated', {
        postId: result.updatedBody.postId,
        threadId,
        parentPostId: null,
      });
    }
    if (result.updated.published) {
      await this.stickerContent.recordUsage(userId, stickerAssetIds);
      if (result.publishing) {
        const publishedPosts = await this.prisma.post.findMany({
          where: { threadId, deletedAt: null },
          select: { content: true },
        });
        const allAssetIds = publishedPosts.flatMap((post) =>
          this.stickerContent
            .extract(post.content)
            .map((token) => token.stickerAssetId)
            .filter((id): id is string => Boolean(id)),
        );
        await this.stickerContent.recordUsage(userId, allAssetIds);
      }
    }
    return result.updated;
  }

  private optimisticLockConflict(subject: string): never {
    throw new BusinessException(
      ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      `${subject}已被修改，请刷新后重试`,
      HttpStatus.CONFLICT,
    );
  }

  private assertPublishReadiness(
    title: string,
    category: string | null,
    contentWithoutDice: string,
  ) {
    if (!title || title === '未命名草稿') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主题帖标题后再发布');
    }
    if (!category) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择分区后再发布');
    }
    if (!hasVisibleMarkdownContent(contentWithoutDice)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请为默认子贴填写正文后再发布');
    }
  }

  private async settleDraftPosts(tx: Prisma.TransactionClient, threadId: string) {
    const posts = await tx.post.findMany({
      where: { threadId, ...notDeleted, subthread: { deletedAt: null } },
      select: {
        id: true,
        kind: true,
        content: true,
        authorId: true,
        author: { select: { username: true } },
        subthreadId: true,
        subthread: { select: { title: true } },
        parentPostId: true,
        replyToPostId: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const members = await tx.threadMember.findMany({
      where: { threadId },
      select: { userId: true, role: true, playerMarked: true },
    });
    const memberByUserId = new Map(members.map((member) => [member.userId, member]));

    for (const post of posts) {
      const rolls = this.dice.rollNodes(this.dice.parseContent(post.content).nodes);
      if (rolls.length > 0) {
        await tx.diceRoll.createMany({ data: this.dice.buildCreateData(post.id, rolls) });
        await tx.post.update({ where: { id: post.id }, data: { version: { increment: 1 } } });
      }
      const member = memberByUserId.get(post.authorId);
      await this.outbox.enqueue(tx, {
        eventType: 'post.created',
        aggregateType: 'Post',
        aggregateId: post.id,
        eventKey: `post-created:${post.id}`,
        payload: {
          postId: post.id,
          content: post.content,
          userId: post.authorId,
          authorUsername: post.author.username,
          occurredAt: new Date().toISOString(),
          threadId,
          subthreadId: post.subthreadId,
          subthreadTitle: post.subthread.title,
          parentPostId: post.parentPostId ?? null,
          replyToPostId: post.replyToPostId ?? null,
          isSubthreadBody: post.kind === 'BODY',
          authorRole: member?.role ?? 'PARTICIPANT',
          authorPlayerMarked: member?.playerMarked ?? false,
          diceRolls: rolls.map((roll) => ({
            nodeId: roll.nodeId,
            notation: roll.notation,
            total: roll.total,
          })),
        },
      });
    }
  }

  private initializePublishedThreadCache(thread: PublishedThreadCacheData) {
    const now = Date.now();
    this.redis.zadd(ZSET_BY_CREATED, thread.createdAt.getTime(), thread.id).catch(() => {});
    this.redis.zadd(ZSET_BY_ACTIVITY, now, thread.id).catch(() => {});
    const postCount = thread._count?.posts ?? 0;
    this.redis
      .hset(`thread:${thread.id}:stats`, 'views', String(thread.viewCount || 0))
      .catch(() => {});
    this.redis.hset(`thread:${thread.id}:stats`, 'replies', String(postCount)).catch(() => {});
    this.redis.hset(`thread:${thread.id}:stats`, 'likes', '0').catch(() => {});
    const tipTotal = thread.tipTotal ?? 0n;
    this.redis.hset(`thread:${thread.id}:stats`, 'tips', tipTotal.toString()).catch(() => {});
    this.redis
      .hset(`thread:${thread.id}:stats`, 'createdAt', String(thread.createdAt.getTime()))
      .catch(() => {});
    const engagement = computeThreadEngagement({
      replies: postCount,
      likes: 0,
      views: thread.viewCount || 0,
      tips: Number(tipTotal),
    });
    this.redis
      .zadd(ZSET_BY_SMART, computeThreadSmartScore(engagement, 0), thread.id)
      .catch(() => {});
  }

  private async syncEditedMentions(
    tx: Prisma.TransactionClient,
    input: {
      postId: string;
      version: number;
      previousContent: string;
      content: string;
      authorUsername: string;
      userId: string;
      threadId: string;
    },
  ) {
    const mentioned = await this.mentions.syncMentionsInTransaction(
      tx,
      input.postId,
      input.content,
      input.userId,
      input.threadId,
      input.previousContent,
    );
    if (mentioned.length === 0) return;

    const payload: PostMentionsUpdatedEvent = {
      postId: input.postId,
      threadId: input.threadId,
      userId: input.userId,
      authorUsername: input.authorUsername,
      recipientIds: mentioned.map((user) => user.userId),
      preview: truncateMarkdown(input.content),
      context: 'body',
    };
    await this.outbox.enqueue(tx, {
      eventType: 'post.mentions.updated',
      aggregateType: 'Post',
      aggregateId: input.postId,
      eventKey: `post-mentions-updated:${input.postId}:v${input.version}`,
      payload,
    });
  }
}
