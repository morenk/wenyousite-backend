import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';
import { notDeleted, countNonDeletedPosts, includeSubthreads, authorSelect, countMembersAndPosts } from '../common/prisma-helpers';

/** 帖子列表 ZSET 键名 */
const ZSET_BY_CREATED = 'threads:by:created';
const ZSET_BY_ACTIVITY = 'threads:by:activity';
const ZSET_BY_SMART = 'threads:by:smart';

/** 主题帖服务：草稿创建、沙盒迭代、发布、CRUD */
@Injectable()
export class ThreadsService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private notificationProducer: NotificationProducer,
    private threadAccess: ThreadAccessService,
    private eventEmitter: EventEmitter2,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  /** 创建主题帖草稿：仅创建 Thread(published=false) + OWNER */
  async create(dto: CreateThreadDto, userId: string) {
    const thread = await this.prisma.thread.create({
      data: {
        title: dto.title ?? '未命名草稿',
        category: dto.category ?? 'DEDUCTION',
        ownerId: userId,
        visibility: dto.visibility ?? 'PUBLIC',
        published: false,
      } as any,
    });

    await this.prisma.threadMember.create({
      data: {
        threadId: thread.id,
        userId: userId,
        role: 'OWNER',
        playerMarked: true,
      },
    });

    if (dto.tagNames && dto.tagNames.length > 0) {
      const tags = await this.tagsService.findOrCreate(dto.tagNames);
      await this.prisma.threadTopicTag.createMany({
        data: tags.map((tag) => ({ threadId: thread.id, tagId: tag.id })),
      });
    }

    return this.prisma.thread.findUnique({
      where: { id: thread.id, ...notDeleted },
      include: {
        owner: { select: authorSelect },
        ...includeSubthreads(),
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });
  }

  /** 我的草稿列表（未发布帖） */
  async findDrafts(userId: string) {
    return this.prisma.thread.findMany({
      where: { ownerId: userId, published: false, ...notDeleted },
      orderBy: { createdAt: 'desc' },
      include: {
        subthreads: {
          where: notDeleted,
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { id: true, title: true },
        },
        topicTags: { include: { tag: true } },
        _count: { select: { subthreads: true, posts: true } },
      },
    });
  }

  /** 详情：主题帖 + 子贴列表。未发布帖仅 owner 可查看 */
  async findById(id: string, userId?: string) {
    await this.threadAccess.assertAccessible(id, userId);

    const cacheKey = this.cache.buildKey('thread', id);

    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      include: {
        owner: { select: authorSelect },
        ...includeSubthreads(),
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    // 浏览量 +1：Redis 计数器 + DB 异步写入
    if (thread.published) {
      this.redis.hincrby(`thread:${id}:stats`, 'views', 1).catch(() => {});
      this.prisma.thread.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      }).catch(() => {});
    }

    // 写入响应缓存 (30 秒)
    if (thread.published) {
      this.cache.set(cacheKey, thread, 30000).catch(() => {});
    }

    return thread;
  }

  /** 分区列表：仅返回已发布帖。首页缓存 5 秒防击穿。recommended 排序使用 Redis ZSET */
  async findAll(query: ThreadQueryDto, userId?: string) {
    const sort = query.sort ?? 'recommended';

    // recommended 排序：ZSET 偏移分页
    if (sort === 'recommended') {
      return this.findAllSmart(query, userId);
    }

    const cacheKey = this.cache.buildKey(
      'threads', 'list',
      `sort:${sort}`,
      `cat:${query.category ?? 'all'}`,
      `tag:${query.tag ?? 'all'}`,
      `filter:${query.filter ?? 'all'}`,
    );

    // 仅首页（无 cursor）尝试缓存命中
    if (!query.cursor) {
      const cached = await this.cache.get<any>(cacheKey);
      if (cached) return cached;
    }

    const where: any = { ...notDeleted, published: true };

    if (query.filter === 'playing') {
      if (!userId) return paginate([], { cursor: null, hasMore: false });
      where.members = {
        some: { userId, playerMarked: true },
      };
    } else {
      where.visibility = 'PUBLIC';
    }

    if (query.category) where.category = query.category;
    if (query.tag) {
      where.topicTags = {
        some: { tag: { name: { contains: query.tag, mode: 'insensitive' } } },
      };
    }

    const take = Math.min(query.limit ?? 20, 50);
    const orderBy: any[] = [{ pinned: 'desc' }, { createdAt: 'desc' }];

    if (sort === 'active') {
      orderBy[1] = { updatedAt: 'desc' };
    }

    const threads = await this.prisma.thread.findMany({
      where,
      orderBy,
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        owner: { select: authorSelect },
        subthreads: {
          where: notDeleted,
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: {
            id: true, title: true, lastPostAt: true,
            bodyPost: { select: { content: true } },
          },
        },
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });

    const hasMore = threads.length > take;
    if (hasMore) threads.pop();

    const result = paginate(threads, {
      cursor: threads.length > 0 ? threads[threads.length - 1].id : null,
      hasMore,
    });

    // 首页写入缓存 (5 秒)
    if (!query.cursor) {
      this.cache.set(cacheKey, result, 5000).catch(() => {});
    }

    return result;
  }

  /** 智能排序：从 Redis ZSET 按偏移分页，SQL 过滤后归位排序 */
  private async findAllSmart(query: ThreadQueryDto, userId?: string) {
    const take = Math.min(query.limit ?? 20, 50);
    const offset = query.cursor ? parseInt(query.cursor, 10) : 0;
    // 多取 3 倍补偿 SQL 过滤损耗
    const fetchCount = take * 3;
    const ids = await this.redis.zrevrange(ZSET_BY_SMART, offset, offset + fetchCount - 1);

    if (ids.length === 0) {
      return paginate([], { cursor: null, hasMore: false });
    }

    const where: any = { ...notDeleted, published: true, id: { in: ids } };
    if (query.filter === 'playing') {
      if (!userId) return paginate([], { cursor: null, hasMore: false });
      where.members = { some: { userId, playerMarked: true } };
    } else {
      where.visibility = 'PUBLIC';
    }
    if (query.category) where.category = query.category;
    if (query.tag) {
      where.topicTags = {
        some: { tag: { name: { contains: query.tag, mode: 'insensitive' } } },
      };
    }

    const threads = await this.prisma.thread.findMany({
      where,
      include: {
        owner: { select: authorSelect },
        subthreads: {
          where: notDeleted,
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: {
            id: true, title: true, lastPostAt: true,
            bodyPost: { select: { content: true } },
          },
        },
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });

    // 按 ZSET 原有顺序排列
    const idOrder = new Map(ids.map((id, i) => [id, i]));
    threads.sort((a, b) => (idOrder.get(a.id) ?? 9999) - (idOrder.get(b.id) ?? 9999));

    const sliced = threads.slice(0, take);
    const hasMore = threads.length > take || ids.length >= fetchCount;
    const nextCursor = hasMore ? String(offset + (sliced.length > 0 ? offset + sliced.length : take)) : null;

    return paginate(sliced, { cursor: nextCursor, hasMore });
  }

  /** 查看指定用户参与的主题帖（被标记为玩家，受 showPlayerBadges 隐私开关控制） */
  async findByPlayedUser(targetId: string, viewerId?: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 50);
    const where: any = {
      userId: targetId,
      playerMarked: true,
      thread: { ...notDeleted, published: true },
    };

    if (targetId !== viewerId) {
      where.thread.visibility = 'PUBLIC';
    }

    const members = await this.prisma.threadMember.findMany({
      where,
      orderBy: { joinedAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        thread: {
          include: {
            owner: { select: authorSelect },
            subthreads: {
              where: notDeleted,
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: { id: true, title: true, lastPostAt: true },
            },
            topicTags: { include: { tag: true } },
            ...countMembersAndPosts(),
          },
        },
      },
    });

    const hasMore = members.length > take;
    if (hasMore) members.pop();

    return paginate(
      members.map(m => m.thread),
      { cursor: members.length > 0 ? members[members.length - 1].id : null, hasMore },
    );
  }

  /** 修改主题帖（仅 OWNER/COLLABORATOR）。published=true 触发发布 */
  async update(id: string, dto: { title?: string; category?: string; status?: string; visibility?: string; published?: boolean; version: number }, userId: string) {
    await this.threadAccess.assertCanManage(id, userId);
    const { version, published, ...data } = dto;

    // 发布校验
    if (published === true) {
      const thread = await this.prisma.thread.findUnique({
        where: { id, ...notDeleted },
        select: { published: true, title: true, category: true },
      });
      if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      if (thread.published) throw new BusinessException(ErrorCode.BAD_REQUEST, '主题帖已发布');

      const effectiveTitle = (data as any).title ?? thread.title;
      const effectiveCategory = (data as any).category ?? thread.category;
      await this.validatePublishReadiness(id, effectiveTitle, effectiveCategory);
    }

    const updateData: any = { ...data, version: { increment: 1 } };
    if (published !== undefined) {
      updateData.published = published;
      updateData.publishedAt = new Date();
    }

    const updated = await this.prisma.thread.update({
      where: { id, version, ...notDeleted },
      data: updateData,
      include: {
        owner: { select: authorSelect },
        ...includeSubthreads(),
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    }).catch(() => {
      throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, '主题帖已被修改，请刷新后重试', HttpStatus.CONFLICT);
    });

    // 缓存失效事件 + ZSET 维护
    if (published === true) {
      const now = Date.now();
      this.redis.zadd(ZSET_BY_CREATED, updated.createdAt.getTime(), id).catch(() => {});
      this.redis.zadd(ZSET_BY_ACTIVITY, now, id).catch(() => {});
      // 初始化计数器（含 createdAt 供智能排序计算年龄）
      const postCount = (updated as any)._count?.posts ?? 0;
      this.redis.hset(`thread:${id}:stats`, 'views', String(updated.viewCount || 0)).catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'replies', String(postCount)).catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'likes', '0').catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'createdAt', String(updated.createdAt.getTime())).catch(() => {});
      // 智能排序初始分
      const initEngagement = postCount * 2;
      const initScore = initEngagement / Math.pow(2, 1.5);
      this.redis.zadd(ZSET_BY_SMART, initScore, id).catch(() => {});

      this.eventEmitter.emit('thread.published', { threadId: id, ownerId: userId });
    }
    this.eventEmitter.emit('thread.updated', { threadId: id });

    // 发布后通知粉丝
    if (published === true) {
      // 先补发草稿期间帖子的 @提及解析和新楼层/子贴通知
      await this.replayDraftPostEvents(updated.id).catch(() => {});

      // 再通知粉丝（确保以上通知入队后才发）
      const followers = await this.prisma.userFollow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
      });
      const followerIds = followers.map(f => f.followerId);
      if (followerIds.length > 0) {
        this.notificationProducer.notify(
          'thread_created',
          followerIds,
          `${updated.owner.username}创建了新主题帖`,
          { threadId: updated.id, fromUserId: userId },
        ).catch(() => {});
      }
    }

    return updated;
  }

  /** 删除：未发布帖硬删除（级联），已发布帖软删除 */
  async remove(id: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id, ...notDeleted } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (thread.ownerId !== userId) throw forbidden('仅楼主可删除主题帖', ErrorCode.NOT_THREAD_OWNER);

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

  /** 校验发布前完整性 */
  async validatePublishReadiness(threadId: string, title: string, category: string) {
    if (!title || !title.trim() || title === '未命名草稿') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主题帖标题后再发布');
    }
    if (!category) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择分区后再发布');
    }

    const subthread = await this.prisma.subthread.findFirst({
      where: { threadId, ...notDeleted },
      include: { posts: { where: notDeleted, take: 1 } },
    });

    if (!subthread) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少创建一个子贴后再发布');
    }
    if (subthread.posts.length === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请在子贴中至少撰写一个楼层后再发布');
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
    if (thread.ownerId !== userId) throw forbidden('仅楼主可管理邀请链接', ErrorCode.NOT_THREAD_OWNER);
    if (!thread.published) throw forbidden('请先发布主题帖');
    if (thread.visibility !== 'PRIVATE') throw forbidden('仅私密帖可生成邀请链接');

    return this.prisma.threadInvite.upsert({
      where: { threadId },
      create: { threadId, token: this.generateToken() },
      update: { token: this.generateToken() },
    });
  }

  /** 通过邀请链接加入私密帖（需已发布） */
  async joinByInviteLink(token: string, userId: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: { thread: { select: { id: true, visibility: true, published: true, deletedAt: true } } },
    });
    if (!invite || invite.thread.deletedAt) throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    if (!invite.thread.published) throw forbidden('该主题帖尚未发布');
    if (invite.thread.visibility !== 'PRIVATE') throw forbidden('该主题帖为公开帖，可直接加入');

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: invite.threadId, userId } },
    });
    if (existing) throw new BusinessException(ErrorCode.ALREADY_MEMBER, '已是该主题帖参与人', HttpStatus.CONFLICT);

    return this.prisma.threadMember.create({
      data: { threadId: invite.threadId, userId, role: 'PARTICIPANT' },
      include: {
        thread: { select: { id: true, title: true } },
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  /** 发布后补发：遍历草稿内全部帖子，逐一发射 post.created 事件以补解析 @提及和通知 */
  private async replayDraftPostEvents(threadId: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        threadId,
        ...notDeleted,
        subthread: { deletedAt: null },
      },
      select: {
        id: true,
        content: true,
        authorId: true,
        author: { select: { username: true } },
        subthreadId: true,
        subthread: { select: { title: true, bodyPostId: true } },
        parentPostId: true,
        replyToPostId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const post of posts) {
      this.eventEmitter.emit('post.created', {
        postId: post.id,
        content: post.content,
        userId: post.authorId,
        authorUsername: post.author.username,
        threadId,
        subthreadId: post.subthreadId,
        subthreadTitle: post.subthread.title,
        parentPostId: post.parentPostId ?? null,
        replyToPostId: post.replyToPostId ?? null,
        isSubthreadBody: post.subthread.bodyPostId === post.id,
      });
    }
  }

  /** 生成随机邀请 token（密码学安全） */
  private generateToken(): string {
    return randomBytes(16).toString('base64url').slice(0, 16);
  }
}
