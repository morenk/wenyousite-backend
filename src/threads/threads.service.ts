import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { RedisService } from '../redis/redis.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import {
  notDeleted,
  includeSubthreads,
  mapSubthreadBody,
  authorSelect,
  countMembersAndPosts,
  attachPlayerCounts,
} from '../common/prisma-helpers';
import { hasVisibleMarkdownContent, normalizeMarkdownContent } from '../common/markdown-content';
import { DiceService } from '../dice/dice.service';
import { ThreadQueryService } from './thread-query.service';
import { OutboxService } from '../outbox/outbox.service';
import { StickerContentService } from '../stickers/sticker-content.service';

/** 帖子列表 ZSET 键名 */
const ZSET_BY_CREATED = 'threads:by:created';
const ZSET_BY_ACTIVITY = 'threads:by:activity';
const ZSET_BY_SMART = 'threads:by:smart';

/** 每个用户最多可持有的未发布主题帖草稿数 */
const MAX_THREAD_DRAFTS = 10;

/** 主题帖服务：草稿创建、沙盒迭代、发布、CRUD */
@Injectable()
export class ThreadsService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private threadAccess: ThreadAccessService,
    private eventEmitter: EventEmitter2,
    private redis: RedisService,
    private diceService: DiceService,
    private queries: ThreadQueryService,
    private outbox: OutboxService,
    private stickerContent: StickerContentService,
  ) {}

  /** 创建主题帖草稿：事务内创建 Thread + Owner + 默认子贴 + 可选子贴正文，一次请求完成 */
  async create(dto: CreateThreadDto, userId: string) {
    const title = dto.title ?? '未命名草稿';
    const subthreadTitle = dto.subthreadTitle ?? title;
    const category = dto.category ?? 'DEDUCTION';
    const visibility = dto.visibility ?? 'PUBLIC';
    const parsedContent = this.diceService.parseContent(
      normalizeMarkdownContent(dto.content ?? ''),
    );
    const hasBody =
      hasVisibleMarkdownContent(parsedContent.contentWithoutDice) || parsedContent.nodes.length > 0;
    await this.stickerContent.assertContentAllowed(userId, parsedContent.content);
    // 标签定义可先独立解析，但主题、默认子贴及标签关联必须原子提交。
    const tags =
      dto.tagNames && dto.tagNames.length > 0
        ? await this.tagsService.findOrCreate(dto.tagNames)
        : [];

    const result = await this.prisma.$transaction(async (tx) => {
      // 0. 草稿数上限校验：未发布草稿超过上限则拒绝创建
      const draftCount = await tx.thread.count({
        where: { ownerId: userId, published: false, ...notDeleted },
      });
      if (draftCount >= MAX_THREAD_DRAFTS) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `草稿数量已达上限（${MAX_THREAD_DRAFTS}/${MAX_THREAD_DRAFTS}），请先发布或删除旧草稿`,
        );
      }

      // 1. 创建 Thread
      const thread = await tx.thread.create({
        data: { title, category, ownerId: userId, visibility, published: false } as any,
      });

      // 2. 创建 OWNER 成员
      await tx.threadMember.create({
        data: { threadId: thread.id, userId, role: 'OWNER', playerMarked: true },
      });

      // 3. 创建默认子贴
      const subthread = await tx.subthread.create({
        data: { threadId: thread.id, title: subthreadTitle, sortOrder: 0 },
      });

      // 4. 若有正文则创建正文帖（kind=BODY，不占楼层号）
      if (hasBody) {
        await tx.post.create({
          data: {
            threadId: thread.id,
            subthreadId: subthread.id,
            authorId: userId,
            kind: 'BODY',
            content: parsedContent.content,
          },
        });
      }

      // 5. 回写默认子贴引用
      await tx.thread.update({
        where: { id: thread.id },
        data: { defaultSubthreadId: subthread.id },
      });

      if (tags.length > 0) {
        await tx.threadTopicTag.createMany({
          data: tags.map((tag) => ({ threadId: thread.id, tagId: tag.id })),
        });
      }

      return { threadId: thread.id };
    });

    const thread = await this.prisma.thread.findUnique({
      where: { id: result.threadId, ...notDeleted },
      include: {
        owner: { select: authorSelect },
        ...includeSubthreads(),
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });
    if (thread) {
      thread.subthreads = mapSubthreadBody(thread.subthreads);
      await attachPlayerCounts(this.prisma, [thread]);
    }
    return thread;
  }

  async findDrafts(userId: string) {
    return this.queries.findDrafts(userId);
  }

  async findById(id: string, userId?: string) {
    return this.queries.findById(id, userId);
  }

  async findAll(query: ThreadQueryDto, userId?: string) {
    return this.queries.findAll(query, userId);
  }

  async findByPlayedUser(
    targetId: string,
    viewerId?: string,
    cursor?: string,
    limit = 20,
    visibility?: 'PUBLIC' | 'PRIVATE',
  ) {
    return this.queries.findByPlayedUser(targetId, viewerId, cursor, limit, visibility);
  }

  async findByCreatedUser(targetId: string, viewerId?: string, cursor?: string, limit = 20) {
    return this.queries.findByCreatedUser(targetId, viewerId, cursor, limit);
  }

  /** 修改主题帖（仅 OWNER/COLLABORATOR）。published=true 触发发布 */
  async update(
    id: string,
    dto: {
      title?: string;
      category?: string;
      status?: string;
      visibility?: string;
      published?: boolean;
      version: number;
    },
    userId: string,
  ) {
    const manager = await this.threadAccess.assertCanManage(id, userId);
    const { version, published, ...data } = dto;

    if (
      manager.role === 'COLLABORATOR' &&
      (dto.visibility !== undefined || published !== undefined)
    ) {
      throw forbidden('仅楼主可修改可见性或发布主题帖', ErrorCode.NOT_THREAD_OWNER);
    }
    if (published === false) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '已发布主题帖不能撤回为草稿');
    }

    const updateData: any = { ...data, version: { increment: 1 } };
    if (published !== undefined) {
      updateData.published = published;
      updateData.publishedAt = new Date();
    }

    const updated = await (
      published === true
        ? this.publishThreadTransaction(id, version, data)
        : this.prisma.thread.update({
            where: { id, version, ...notDeleted },
            data: updateData,
            include: {
              owner: { select: authorSelect },
              ...includeSubthreads(),
              topicTags: { include: { tag: true } },
              ...countMembersAndPosts(),
            },
          })
    ).catch((err) => {
      if (err?.code === 'P2025')
        throw new BusinessException(
          ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
          '主题帖已被修改，请刷新后重试',
          HttpStatus.CONFLICT,
        );
      throw err;
    });

    updated.subthreads = mapSubthreadBody(updated.subthreads);
    await attachPlayerCounts(this.prisma, [updated]);

    // 缓存失效事件 + ZSET 维护
    if (published === true) {
      const now = Date.now();
      this.redis.zadd(ZSET_BY_CREATED, updated.createdAt.getTime(), id).catch(() => {});
      this.redis.zadd(ZSET_BY_ACTIVITY, now, id).catch(() => {});
      // 初始化计数器（含 createdAt 供智能排序计算年龄）
      const postCount = (updated as any)._count?.posts ?? 0;
      this.redis
        .hset(`thread:${id}:stats`, 'views', String(updated.viewCount || 0))
        .catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'replies', String(postCount)).catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'likes', '0').catch(() => {});
      this.redis
        .hset(`thread:${id}:stats`, 'createdAt', String(updated.createdAt.getTime()))
        .catch(() => {});
      // 智能排序初始分
      const initEngagement = postCount * 2;
      const initScore = initEngagement / Math.pow(2, 1.5);
      this.redis.zadd(ZSET_BY_SMART, initScore, id).catch(() => {});
    }
    this.eventEmitter.emit('thread.updated', { threadId: id });

    return updated;
  }

  /** 删除：未发布帖硬删除（级联），已发布帖软删除 */
  async remove(id: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id, ...notDeleted } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (thread.ownerId !== userId)
      throw forbidden('仅楼主可删除主题帖', ErrorCode.NOT_THREAD_OWNER);

    let result: any;
    if (!thread.published) {
      result = this.prisma.thread.delete({ where: { id } });
    } else {
      result = this.prisma.thread.update({
        where: { id, ...notDeleted },
        data: { deletedAt: new Date() },
      });
    }

    // ZSET 清理 + 缓存失效 + 计数器清理
    this.redis.zrem(ZSET_BY_CREATED, id).catch(() => {});
    this.redis.zrem(ZSET_BY_ACTIVITY, id).catch(() => {});
    this.redis.zrem(ZSET_BY_SMART, id).catch(() => {});
    this.redis.hdelAll(`thread:${id}:stats`).catch(() => {});
    this.eventEmitter.emit('thread.deleted', { threadId: id });

    return result;
  }

  /** 点赞主题帖（幂等） */
  async like(id: string, userId: string, username: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, published: true, ownerId: true, title: true, likeCount: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw new BusinessException(ErrorCode.BAD_REQUEST, '草稿暂不支持点赞');
    await this.threadAccess.assertAccessible(id, userId);

    const { updated } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.threadLike.createMany({
        data: [{ threadId: id, userId }],
        skipDuplicates: true,
      });
      if (result.count === 0) return { created: false, updated: thread };
      const updatedThread = await tx.thread.update({
        where: { id },
        data: { likeCount: { increment: 1 } },
      });
      const eventId = randomUUID();
      await this.outbox.enqueue(tx, {
        eventType: 'thread.liked',
        aggregateType: 'Thread',
        aggregateId: id,
        eventKey: `thread-liked:${id}:${userId}:${eventId}`,
        payload: {
          eventId,
          threadId: id,
          ownerId: thread.ownerId,
          threadTitle: thread.title,
          userId,
          username,
        },
      });
      return {
        created: true,
        updated: updatedThread,
      };
    });

    return { id: updated.id, likeCount: updated.likeCount };
  }

  /** 取消点赞主题帖（幂等） */
  async unlike(id: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, published: true, likeCount: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    const { updated } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.threadLike.deleteMany({ where: { threadId: id, userId } });
      if (result.count === 0) return { deleted: false, updated: thread };
      const updatedThread = await tx.thread.update({
        where: { id },
        data: { likeCount: { decrement: 1 } },
      });
      const eventId = randomUUID();
      await this.outbox.enqueue(tx, {
        eventType: 'thread.unliked',
        aggregateType: 'Thread',
        aggregateId: id,
        eventKey: `thread-unliked:${id}:${userId}:${eventId}`,
        payload: { eventId, threadId: id },
      });
      return {
        deleted: true,
        updated: updatedThread,
      };
    });
    return { id: updated.id, likeCount: updated.likeCount };
  }

  /** 发布事务：锁主题帖，结算全部待掷骰子，并与 published 状态原子提交。 */
  private async publishThreadTransaction(
    id: string,
    version: number,
    data: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${id} FOR UPDATE`;
      const thread = await tx.thread.findUnique({
        where: { id, ...notDeleted },
        select: {
          published: true,
          title: true,
          category: true,
          defaultSubthread: {
            select: {
              id: true,
              posts: {
                where: { ...notDeleted, kind: 'BODY' },
                take: 1,
                select: { content: true },
              },
            },
          },
        },
      });
      if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      if (thread.published) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '主题帖已发布');
      }

      const effectiveTitle = (data.title as string | undefined) ?? thread.title ?? '';
      const effectiveCategory = (data.category as string | undefined) ?? thread.category;
      this.assertPublishReadiness(effectiveTitle, effectiveCategory, thread.defaultSubthread);

      const posts = await tx.post.findMany({
        where: { threadId: id, ...notDeleted, subthread: { deletedAt: null } },
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
        where: { threadId: id },
        select: { userId: true, role: true, playerMarked: true },
      });
      const memberByUserId = new Map(members.map((member) => [member.userId, member]));

      const generated = posts.map((post) => ({
        post,
        rolls: this.diceService.rollNodes(this.diceService.parseContent(post.content).nodes),
      }));

      for (const { post, rolls } of generated) {
        if (rolls.length === 0) continue;
        await tx.diceRoll.createMany({
          data: this.diceService.buildCreateData(post.id, rolls),
        });
        await tx.post.update({
          where: { id: post.id },
          data: { version: { increment: 1 } },
        });
      }

      const updated = await tx.thread.update({
        where: { id, version, ...notDeleted },
        data: {
          ...data,
          published: true,
          publishedAt: new Date(),
          version: { increment: 1 },
        },
        include: {
          owner: { select: authorSelect },
          ...includeSubthreads(),
          topicTags: { include: { tag: true } },
          ...countMembersAndPosts(),
        },
      });

      for (const { post, rolls } of generated) {
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
            threadId: id,
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
          } as Prisma.InputJsonValue,
        });
      }
      await this.outbox.enqueue(tx, {
        eventType: 'thread.published',
        aggregateType: 'Thread',
        aggregateId: id,
        eventKey: `thread-published:${id}`,
        payload: {
          threadId: id,
          ownerId: updated.ownerId,
          ownerUsername: updated.owner.username,
        },
      });

      return updated;
    });
  }

  /** 校验发布前完整性 */
  async validatePublishReadiness(threadId: string, title: string, category: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, ...notDeleted },
      select: {
        defaultSubthread: {
          select: {
            id: true,
            posts: { where: { ...notDeleted, kind: 'BODY' }, take: 1 },
          },
        },
      },
    });

    this.assertPublishReadiness(title, category, thread?.defaultSubthread ?? null);
  }

  private assertPublishReadiness(
    title: string,
    category: string,
    defaultSubthread: { posts: { content: string }[] } | null,
  ) {
    if (!title || !title.trim() || title === '未命名草稿') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主题帖标题后再发布');
    }
    if (!category) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择分区后再发布');
    }
    if (!defaultSubthread) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少创建一个子贴后再发布');
    }
    const bodyContent = defaultSubthread.posts[0]?.content ?? '';
    const parsedBody = this.diceService.parseContent(bodyContent);
    if (!hasVisibleMarkdownContent(parsedBody.contentWithoutDice)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请将子贴至少填写正文再发布');
    }
  }

  /** 检查当前用户是否有管理权限（OWNER 或 COLLABORATOR） */
  async assertCanManage(threadId: string, userId: string) {
    return this.threadAccess.assertCanManage(threadId, userId);
  }

  /** 生成或刷新私密帖邀请链接（仅 OWNER，已发布 + 私密帖） */
  async createInviteLink(threadId: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId, ...notDeleted } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (thread.ownerId !== userId)
      throw forbidden('仅楼主可管理邀请链接', ErrorCode.NOT_THREAD_OWNER);
    if (!thread.published) throw forbidden('请先发布主题帖');
    if (thread.visibility !== 'PRIVATE') throw forbidden('仅私密帖可生成邀请链接');

    return this.prisma.threadInvite.upsert({
      where: { threadId },
      create: { threadId, token: this.generateToken() },
      update: { token: this.generateToken() },
    });
  }

  /** 预览邀请链接对应的私密帖信息（不创建成员） */
  async previewInviteLink(token: string, userId?: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: {
        thread: {
          select: {
            id: true,
            title: true,
            category: true,
            status: true,
            visibility: true,
            published: true,
            deletedAt: true,
            createdAt: true,
            owner: { select: authorSelect },
          },
        },
      },
    });
    if (!invite || invite.thread.deletedAt)
      throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    if (!invite.thread.published) throw forbidden('该主题帖尚未发布');
    if (invite.thread.visibility !== 'PRIVATE') throw forbidden('该主题帖为公开帖，可直接加入');

    const memberCount = await this.prisma.threadMember.count({
      where: { threadId: invite.threadId },
    });
    const existingMember = userId
      ? await this.prisma.threadMember.findUnique({
          where: { threadId_userId: { threadId: invite.threadId, userId } },
          select: { id: true },
        })
      : null;

    return {
      thread: {
        id: invite.thread.id,
        title: invite.thread.title,
        category: invite.thread.category,
        status: invite.thread.status,
        owner: invite.thread.owner,
        memberCount,
        createdAt: invite.thread.createdAt,
      },
      alreadyJoined: !!existingMember,
    };
  }

  /** 通过邀请链接加入私密帖（需已发布） */
  async joinByInviteLink(token: string, userId: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: {
        thread: { select: { id: true, visibility: true, published: true, deletedAt: true } },
      },
    });
    if (!invite || invite.thread.deletedAt)
      throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    if (!invite.thread.published) throw forbidden('该主题帖尚未发布');
    if (invite.thread.visibility !== 'PRIVATE') throw forbidden('该主题帖为公开帖，可直接加入');

    return this.prisma.threadMember.upsert({
      where: { threadId_userId: { threadId: invite.threadId, userId } },
      create: { threadId: invite.threadId, userId, role: 'PARTICIPANT' },
      update: {},
      include: {
        thread: { select: { id: true, title: true } },
        user: { select: authorSelect },
      },
    });
  }

  /** 生成随机邀请 token（密码学安全） */
  private generateToken(): string {
    return randomBytes(16).toString('base64url').slice(0, 16);
  }
}
