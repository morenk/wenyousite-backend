import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { BlockFilterService } from '../common/services/block-filter.service';
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
import { notDeleted, countNonDeletedPosts, includeSubthreads, mapSubthreadBody, authorSelect, countMembersAndPosts, attachPlayerCounts } from '../common/prisma-helpers';
import { truncateMarkdown } from '../common/markdown-truncate';

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
    private blockFilter: BlockFilterService,
    private eventEmitter: EventEmitter2,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  /** 创建主题帖草稿：事务内创建 Thread + Owner + 默认子贴 + 可选子贴正文，一次请求完成 */
  async create(dto: CreateThreadDto, userId: string) {
    const title = dto.title ?? '未命名草稿';
    const subthreadTitle = dto.subthreadTitle ?? title;
    const category = dto.category ?? 'DEDUCTION';
    const visibility = dto.visibility ?? 'PUBLIC';
    const hasContent = !!dto.content?.trim();

    const result = await this.prisma.$transaction(async (tx) => {
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
      if (hasContent) {
        await tx.post.create({
          data: { threadId: thread.id, subthreadId: subthread.id, authorId: userId, kind: 'BODY', content: dto.content! },
        });
      }

      // 5. 回写默认子贴引用
      await tx.thread.update({
        where: { id: thread.id },
        data: { defaultSubthreadId: subthread.id },
      });

      return { threadId: thread.id };
    });

    // 6. 事务外处理标签（避免事务内复杂联表死锁）
    if (dto.tagNames && dto.tagNames.length > 0) {
      const tags = await this.tagsService.findOrCreate(dto.tagNames);
      await this.prisma.threadTopicTag.createMany({
        data: tags.map((tag) => ({ threadId: result.threadId, tagId: tag.id })),
      });
    }

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

  /** 我的草稿列表（未发布帖） */
  async findDrafts(userId: string) {
    const drafts = await this.prisma.thread.findMany({
      where: { ownerId: userId, published: false, ...notDeleted },
      orderBy: { createdAt: 'desc' },
      include: {
        defaultSubthread: { select: { id: true, title: true } },
        topicTags: { include: { tag: true } },
        _count: { select: { subthreads: true, posts: true } },
      },
    });
    return drafts;
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

    // 把子贴的 posts[0]（kind=BODY）映射回 bodyPost 响应字段
    thread.subthreads = mapSubthreadBody(thread.subthreads);

    await attachPlayerCounts(this.prisma, [thread]);

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
        defaultSubthread: {
          include: {
            posts: {
              where: { kind: 'BODY', ...notDeleted },
              take: 1,
              orderBy: { createdAt: 'asc' },
              select: { content: true },
            },
          },
        },
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });

    const hasMore = threads.length > take;
    if (hasMore) threads.pop();

    await attachPlayerCounts(this.prisma, threads);

    const items = threads.map((t: any) => {
      const preview = t.defaultSubthread?.posts?.[0]?.content
        ? truncateMarkdown(t.defaultSubthread.posts[0].content)
        : '';
      // 移除 defaultSubthread.posts 全量，仅保留 preview
      const { posts, ...rest } = t.defaultSubthread ?? {};
      return { ...t, preview, defaultSubthread: t.defaultSubthread ? rest : null };
    });

    const result = paginate(items, {
      cursor: items.length > 0 ? items[items.length - 1].id : null,
      hasMore,
    });

    // 首页写入缓存 (5 秒)
    if (!query.cursor) {
      this.cache.set(cacheKey, result, 5000).catch(() => {});
    }

    return result;
  }

  /** 智能排序：从 Redis ZSET 按「已消费可见帖数」累进分页，SQL 过滤后归位切片，保证每帖只出现一次 */
  private async findAllSmart(query: ThreadQueryDto, userId?: string) {
    const take = Math.min(query.limit ?? 20, 50);
    // cursor 记录「已消费的可见帖数」，单调累进
    const consumed = query.cursor ? parseInt(query.cursor, 10) : 0;
    const zsetSize = await this.redis.zcard(ZSET_BY_SMART);

    const where: any = { ...notDeleted, published: true };
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

    // 前缀累进扫描：从 ZSET 头部取足够长的前缀，SQL 过滤后按 ZSET 序排列
    // 若前缀内可见帖仍不足以切够 take 个，扩大扫描窗口继续取（补偿过滤损耗）
    let scanEnd = consumed + take * 5;
    let ids: string[] = [];
    let threads: any[] = [];

    for (;;) {
      const batch = await this.redis.zrevrange(ZSET_BY_SMART, 0, scanEnd - 1);
      if (batch.length === 0) {
        // ZSET 为空或超出范围
        return paginate([], { cursor: null, hasMore: false });
      }
      ids = batch;
      threads = await this.fetchSmartThreads(ids, where);
      if (threads.length >= consumed + take || scanEnd >= zsetSize) break;
      // 过滤损耗大：扩大前缀继续扫描
      scanEnd = scanEnd * 2;
    }

    // 按 ZSET 原有顺序排列
    const idOrder = new Map(ids.map((id, i) => [id, i]));
    threads.sort((a, b) => (idOrder.get(a.id) ?? 9999) - (idOrder.get(b.id) ?? 9999));

    const sliced = threads.slice(consumed, consumed + take);
    const hasMore = threads.length > consumed + take;
    const nextCursor = hasMore ? String(consumed + sliced.length) : null;

    await attachPlayerCounts(this.prisma, sliced);

    const items = sliced.map((t: any) => {
      const preview = t.defaultSubthread?.posts?.[0]?.content
        ? truncateMarkdown(t.defaultSubthread.posts[0].content)
        : '';
      // 移除 defaultSubthread.posts 全量，仅保留 preview
      const { posts, ...rest } = t.defaultSubthread ?? {};
      return { ...t, preview, defaultSubthread: t.defaultSubthread ? rest : null };
    });

    return paginate(items, { cursor: nextCursor, hasMore });
  }

  /** 按 id 列表查询已发布帖（含 owner/defaultSubthread/topicTags/_count），供智能排序过滤用 */
  private async fetchSmartThreads(ids: string[], where: Record<string, unknown>) {
    return this.prisma.thread.findMany({
      where: { ...where, id: { in: ids } },
      include: {
        owner: { select: authorSelect },
        defaultSubthread: {
          include: {
            posts: {
              where: { kind: 'BODY', ...notDeleted },
              take: 1,
              orderBy: { createdAt: 'asc' },
              select: { content: true },
            },
          },
        },
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });
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
            defaultSubthread: { select: { id: true, title: true, lastPostAt: true } },
            topicTags: { include: { tag: true } },
            ...countMembersAndPosts(),
          },
        },
      },
    });

    const hasMore = members.length > take;
    if (hasMore) members.pop();

    const playedThreads = members.map(m => m.thread);
    await attachPlayerCounts(this.prisma, playedThreads);

    return paginate(
      playedThreads,
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
    }).catch((err) => {
      if (err?.code === 'P2025') throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, '主题帖已被修改，请刷新后重试', HttpStatus.CONFLICT);
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
      this.redis.hset(`thread:${id}:stats`, 'views', String(updated.viewCount || 0)).catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'replies', String(postCount)).catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'likes', '0').catch(() => {});
      this.redis.hset(`thread:${id}:stats`, 'createdAt', String(updated.createdAt.getTime())).catch(() => {});
      // 智能排序初始分
      const initEngagement = postCount * 2;
      const initScore = initEngagement / Math.pow(2, 1.5);
      this.redis.zadd(ZSET_BY_SMART, initScore, id).catch(() => {});
    }
    this.eventEmitter.emit('thread.updated', { threadId: id });

    if (published === true) {
      // 1. 先回放草稿帖事件（@提及 + 通知）
      await this.replayDraftPostEvents(updated.id).catch(() => {});
      // 2. 再发射 thread.published（此时内容已完整处理）
      this.eventEmitter.emit('thread.published', { threadId: id, ownerId: userId });

      const followers = await this.prisma.userFollow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
      });
      const followerIds = followers.map(f => f.followerId);
      if (followerIds.length > 0) {
        const blockSets = await this.blockFilter.loadBlockSets(userId);
        const filtered = this.blockFilter.filterRecipients(followerIds, blockSets);
        if (filtered.length > 0) {
          this.notificationProducer.notify(
            'thread_created',
            filtered,
            `${updated.owner.username}创建了新主题帖`,
            { threadId: updated.id, fromUserId: userId },
          ).catch(() => {});
        }
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

  /** 点赞主题帖（幂等） */
  async like(id: string, userId: string, username: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, published: true, ownerId: true, title: true, likeCount: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw new BusinessException(ErrorCode.BAD_REQUEST, '草稿暂不支持点赞');
    await this.threadAccess.assertAccessible(id, userId);

    const existing = await this.prisma.threadLike.findUnique({
      where: { threadId_userId: { threadId: id, userId } },
    });
    if (existing) return thread;

    await this.prisma.threadLike.create({ data: { threadId: id, userId } });

    const updated = await this.prisma.thread.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    });

    this.redis.hincrby(`thread:${id}:stats`, 'likes', 1).catch(() => {});

    if (thread.ownerId !== userId) {
      const blockSets = await this.blockFilter.loadBlockSets(userId);
      const filtered = this.blockFilter.filterRecipients([thread.ownerId], blockSets);
      if (filtered.length > 0) {
        this.notificationProducer.notify(
          'like',
          [thread.ownerId],
          `${username} 赞了你的主题帖「${thread.title}」`,
          { threadId: id, fromUserId: userId,
            payload: { action: 'like', actorName: username, totalCount: 1, likers: [{ userId, username }] } },
        ).catch(() => {});
      }
    }

    this.eventEmitter.emit('thread.liked', { threadId: id });
    return updated;
  }

  /** 取消点赞主题帖（幂等） */
  async unlike(id: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, published: true, likeCount: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    const result = await this.prisma.threadLike.deleteMany({
      where: { threadId: id, userId },
    });
    if (result.count === 0) return thread;

    const updated = await this.prisma.thread.update({
      where: { id },
      data: { likeCount: { increment: -1 } },
    });

    this.redis.hincrby(`thread:${id}:stats`, 'likes', -1).catch(() => {});
    this.eventEmitter.emit('thread.unliked', { threadId: id });
    return updated;
  }

  /** 校验发布前完整性 */
  async validatePublishReadiness(threadId: string, title: string, category: string) {
    if (!title || !title.trim() || title === '未命名草稿') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主题帖标题后再发布');
    }
    if (!category) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择分区后再发布');
    }

    // 检查默认子贴是否存在且有正文
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

    if (!thread?.defaultSubthread) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少创建一个子贴后再发布');
    }
    if (thread.defaultSubthread.posts.length === 0) {
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
    if (thread.ownerId !== userId) throw forbidden('仅楼主可管理邀请链接', ErrorCode.NOT_THREAD_OWNER);
    if (!thread.published) throw forbidden('请先发布主题帖');
    if (thread.visibility !== 'PRIVATE') throw forbidden('仅私密帖可生成邀请链接');

    return this.prisma.threadInvite.upsert({
      where: { threadId },
      create: { threadId, token: this.generateToken() },
      update: { token: this.generateToken() },
    });
  }

  /** 预览邀请链接对应的私密帖信息（不创建成员） */
  async previewInviteLink(token: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: { thread: { select: { id: true, title: true, category: true, status: true, visibility: true, published: true, deletedAt: true, createdAt: true, owner: { select: authorSelect } } } },
    });
    if (!invite || invite.thread.deletedAt) throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    if (!invite.thread.published) throw forbidden('该主题帖尚未发布');
    if (invite.thread.visibility !== 'PRIVATE') throw forbidden('该主题帖为公开帖，可直接加入');

    const memberCount = await this.prisma.threadMember.count({ where: { threadId: invite.threadId } });

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
    };
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
        isSubthreadBody: post.kind === 'BODY',
      });
    }
  }

  /** 生成随机邀请 token（密码学安全） */
  private generateToken(): string {
    return randomBytes(16).toString('base64url').slice(0, 16);
  }
}
