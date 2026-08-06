import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notFound } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';
import {
  notDeleted,
  countMembersAndPosts,
  attachPlayerCounts,
  authorSelect,
  includeSubthreads,
  mapSubthreadBody,
} from '../common/prisma-helpers';
import { truncateMarkdown } from '../common/markdown-truncate';

const ZSET_BY_SMART = 'threads:by:smart';

/** 主题帖读模型：详情、列表、草稿箱和用户主题聚合查询。 */
@Injectable()
export class ThreadQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
  ) {}

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
    // 权限状态可能在缓存 TTL 内由 PUBLIC 变为 PRIVATE，必须先实时校验。
    await this.threadAccess.assertAccessible(id, userId);
    const cacheKey = this.cache.buildKey('thread', id);
    let thread = await this.cache.get<any>(cacheKey);

    // 详情缓存只保存公开且已发布的聚合结果；私密帖和草稿始终实时查询。
    if (!thread?.published || thread.visibility !== 'PUBLIC' || thread.deletedAt) {
      thread = await this.prisma.thread.findUnique({
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

      if (thread.published && thread.visibility === 'PUBLIC') {
        this.cache.set(cacheKey, thread, 30000).catch(() => {});
      }
    }

    // 浏览量实时写 Redis，每 10 分钟批量落盘，避免每次详情请求写数据库。
    let responseThread = thread;
    if (thread.published) {
      try {
        const viewCount = await this.redis.hincrbyAtLeast(
          `thread:${id}:stats`,
          'views',
          thread.viewCount ?? 0,
          1,
        );
        responseThread = { ...thread, viewCount };
      } catch {
        responseThread = { ...thread, viewCount: (thread.viewCount ?? 0) + 1 };
      }
    }

    // 登录态附加收藏与点赞状态（浅拷贝返回，不污染共享缓存）
    if (userId) {
      const [bookmark, like] = await Promise.all([
        this.prisma.userBookmark.findUnique({
          where: { userId_threadId: { userId, threadId: id } },
          select: { id: true },
        }),
        this.prisma.threadLike.findUnique({
          where: { threadId_userId: { userId, threadId: id } },
          select: { id: true },
        }),
      ]);
      return {
        ...responseThread,
        isBookmarked: !!bookmark,
        bookmarkId: bookmark?.id ?? null,
        isLiked: !!like,
      };
    }

    return responseThread;
  }

  /** 分区列表：仅返回已发布帖。首页缓存 5 秒防击穿。recommended 排序使用 Redis ZSET */
  async findAll(query: ThreadQueryDto, userId?: string) {
    const sort = query.sort ?? 'recommended';
    const cacheKey = this.cache.buildKey(
      'threads',
      'list',
      `sort:${sort}`,
      `cat:${query.category ?? 'all'}`,
      `status:${query.status ?? 'all'}`,
      `tag:${query.tag ?? 'all'}`,
      `filter:${query.filter ?? 'all'}`,
      `limit:${Math.min(query.limit ?? 20, 50)}`,
    );
    const cacheableFirstPage = !query.cursor && query.filter !== 'playing';

    // 公开首页尝试缓存命中；playing 是用户私有结果，严禁进入共享缓存。
    if (cacheableFirstPage) {
      const cached = await this.cache.get<any>(cacheKey);
      if (cached) return cached;
    }

    // recommended 排序：ZSET 偏移分页
    if (sort === 'recommended') {
      const result = await this.findAllSmart(query, userId);
      if (cacheableFirstPage) {
        this.cache.set(cacheKey, result, 5000).catch(() => {});
      }
      return result;
    }

    const where: any = { ...notDeleted, published: true };

    if (query.filter === 'playing') {
      if (!userId) return paginate([], { cursor: null, hasMore: false });
      where.members = {
        some: { userId, playerMarked: true },
      };
      // 参与列表排除自己创建的帖（自建帖在「创建的帖子」中展示）
      where.ownerId = { not: userId };
    } else {
      where.visibility = 'PUBLIC';
    }

    if (query.category) where.category = query.category;
    if (query.status) where.status = query.status;
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
      const rest = { ...(t.defaultSubthread ?? {}) };
      delete rest.posts;
      return { ...t, preview, defaultSubthread: t.defaultSubthread ? rest : null };
    });

    const result = paginate(items, {
      cursor: items.length > 0 ? items[items.length - 1].id : null,
      hasMore,
    });

    // 首页写入缓存 (5 秒)
    if (cacheableFirstPage) {
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
    if (query.status) where.status = query.status;
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
      const rest = { ...(t.defaultSubthread ?? {}) };
      delete rest.posts;
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

  /** 参与帖仅指已被授予玩家身份的帖子；他人只能查看其中的公开帖。 */
  async findByPlayedUser(
    targetId: string,
    viewerId?: string,
    cursor?: string,
    limit = 20,
    visibility?: 'PUBLIC' | 'PRIVATE',
  ) {
    const take = Math.min(limit, 50);
    const isSelf = targetId === viewerId;

    if (!isSelf && visibility === 'PRIVATE') {
      return paginate([], { cursor: null, hasMore: false });
    }

    const where: any = {
      userId: targetId,
      playerMarked: true,
      thread: { ...notDeleted, published: true },
    };
    // 参与列表排除自己创建的帖（自建帖在「创建的帖子」中展示）
    where.thread.ownerId = { not: targetId };

    if (isSelf) {
      if (visibility) where.thread.visibility = visibility;
    } else {
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

    const playedThreads = members.map((m) => m.thread);
    await attachPlayerCounts(this.prisma, playedThreads);

    return paginate(playedThreads, {
      cursor: members.length > 0 ? members[members.length - 1].id : null,
      hasMore,
    });
  }

  /** 查看指定用户创建的主题帖（本人可见全部含私密帖，他人仅见 PUBLIC 已发布帖） */
  async findByCreatedUser(targetId: string, viewerId?: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 50);
    const where: any = {
      ownerId: targetId,
      ...notDeleted,
      published: true,
    };

    if (targetId !== viewerId) {
      where.visibility = 'PUBLIC';
    }

    const threads = await this.prisma.thread.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        owner: { select: authorSelect },
        defaultSubthread: { select: { id: true, title: true, lastPostAt: true } },
        topicTags: { include: { tag: true } },
        ...countMembersAndPosts(),
      },
    });

    const hasMore = threads.length > take;
    if (hasMore) threads.pop();

    await attachPlayerCounts(this.prisma, threads);

    return paginate(threads, {
      cursor: threads.length > 0 ? threads[threads.length - 1].id : null,
      hasMore,
    });
  }
}
