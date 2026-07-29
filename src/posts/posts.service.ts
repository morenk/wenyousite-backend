import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BlockFilterService } from '../common/services/block-filter.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { MentionsService } from '../mentions/mentions.service';
import { ReadingProgressService } from '../reading-progress/reading-progress.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';
import { notDeleted, authorSelect, countNonDeletedReplies } from '../common/prisma-helpers';
import { truncateMarkdown } from '../common/markdown-truncate';

/** 楼层服务：发帖（事务楼层编号 + FOR UPDATE）、楼中楼、编辑、软删除 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private threadAccess: ThreadAccessService,
    private blockFilter: BlockFilterService,
    private notificationProducer: NotificationProducer,
    private mentionsService: MentionsService,
    private readingProgressService: ReadingProgressService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  /** 获取子贴的楼层列表（Cursor 分页），内嵌每个楼层的前 3 条楼中楼回复。已软删子贴返回 404 */
  async findAllBySubthread(subthreadId: string, cursor?: string, limit = 20, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      select: { id: true, threadId: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertAccessible(subthread.threadId, userId);

    const take = Math.min(limit, 50);
    const posts = await this.prisma.post.findMany({
      where: { subthreadId, parentPostId: null, ...notDeleted },
      orderBy: { floorNumber: 'asc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: authorSelect },
        _count: { select: { replies: { where: notDeleted } } },
      },
    });

    const hasMore = posts.length > take;
    if (hasMore) posts.pop();

    // 为有回复的楼层批量获取前 3 条楼中楼回复
    const floorIdsWithReplies = posts.filter(p => p._count.replies > 0).map(p => p.id);
    if (floorIdsWithReplies.length > 0) {
      const repliesMap = new Map<string, any[]>();
      await Promise.all(
        floorIdsWithReplies.map(async (floorId) => {
          const replies = await this.prisma.post.findMany({
            where: { parentPostId: floorId, ...notDeleted },
            orderBy: { createdAt: 'asc' },
            take: 3,
            include: {
              author: { select: authorSelect },
              replyToPost: { select: { id: true, authorId: true } },
            },
          });
          repliesMap.set(floorId, replies);
        }),
      );
      for (const post of posts) {
        (post as any).replies = repliesMap.get(post.id) || [];
      }
    } else {
      for (const post of posts) {
        (post as any).replies = [];
      }
    }

    return paginate(posts, {
      cursor: posts.length > 0 ? posts[posts.length - 1].id : null,
      hasMore,
    });
  }

  /** 获取楼中楼回复列表（cursor 分页）。已软删子贴返回 404 */
  async findReplies(postId: string, cursor?: string, limit = 20, userId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: { id: true, threadId: true, subthread: { select: { deletedAt: true } } },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    if (post.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    await this.threadAccess.assertAccessible(post.threadId, userId);

    const take = Math.min(limit, 50);
    const replies = await this.prisma.post.findMany({
      where: { parentPostId: postId, ...notDeleted },
      orderBy: { createdAt: 'asc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: authorSelect },
        replyToPost: { select: { id: true, authorId: true } },
      },
    });
    const hasMore = replies.length > take;
    if (hasMore) replies.pop();
    return paginate(replies, { cursor: replies.length > 0 ? replies[replies.length - 1].id : null, hasMore });
  }

  /** 发帖：楼层或楼中楼回复。先校验访问权限与发帖策略，通过后才自动加入为参与人 */
  async create(subthreadId: string, dto: CreatePostDto, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      include: { thread: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');

    // 校验主题帖访问权限（私密帖非参与人在此被拦截）
    await this.threadAccess.assertAccessible(subthread.threadId, userId);

    // 先查当前参与人状态（未加入时按未参与处理）
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: subthread.threadId, userId } },
    });

    // 检查发帖权限（通过后才自动加入，避免被拒时仍写入参与人记录）
    if (subthread.postingPolicy === 'COLLABORATORS') {
      if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
        throw forbidden('该子贴仅限协作者发帖', ErrorCode.NOT_COLLABORATOR);
      }
    } else if (subthread.postingPolicy === 'PLAYERS') {
      if (!member || !member.playerMarked) {
        throw forbidden('该子贴仅限玩家发帖', ErrorCode.NOT_PLAYER);
      }
    }

    // 权限校验通过，自动加入主题帖
    await this.prisma.threadMember.upsert({
      where: { threadId_userId: { threadId: subthread.threadId, userId } },
      create: { threadId: subthread.threadId, userId, role: 'PARTICIPANT' },
      update: {},
    });

    // 验证 parentPost 存在、属于同一子贴、且为主楼层
    if (dto.parentPostId) {
      const parent = await this.prisma.post.findUnique({
        where: { id: dto.parentPostId, ...notDeleted },
        select: { id: true, subthreadId: true, parentPostId: true },
      });
      if (!parent) throw notFound(ErrorCode.POST_NOT_FOUND, '父楼层不存在');
      if (parent.subthreadId !== subthreadId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
      }
      if (parent.parentPostId !== null) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '只能回复主楼层');
      }
    }

    // 验证 replyToPost 存在且属于同一子贴
    if (dto.replyToPostId) {
      const target = await this.prisma.post.findUnique({
        where: { id: dto.replyToPostId, ...notDeleted },
        select: { id: true, subthreadId: true },
      });
      if (!target) throw notFound(ErrorCode.POST_NOT_FOUND, '被回复的帖子不存在');
      if (target.subthreadId !== subthreadId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
      }
    }

    // 事务：SELECT FOR UPDATE 锁子贴行 → 读 MAX → 创建帖子 → 更新 lastPostAt
    const post = await this.prisma.$transaction(async (tx) => {
      let floorNumber: number | null = null;

      if (!dto.parentPostId) {
        await tx.$queryRaw`SELECT id FROM subthreads WHERE id = ${subthreadId} FOR UPDATE`;
        const maxFloor = await tx.post.aggregate({
          where: { subthreadId, parentPostId: null },
          _max: { floorNumber: true },
        });
        floorNumber = (maxFloor._max.floorNumber ?? 0) + 1;
      }

      const p = await tx.post.create({
        data: {
          threadId: subthread.threadId,
          subthreadId,
          authorId: userId,
          floorNumber,
          parentPostId: dto.parentPostId ?? null,
          replyToPostId: dto.replyToPostId ?? null,
          content: dto.content,
        },
        include: {
          author: { select: authorSelect },
        },
      });

      await tx.subthread.update({
        where: { id: subthreadId },
        data: { lastPostAt: new Date() },
      });

      return p;
    });

    // 发帖后通过事件解耦：@提及、通知由 PostEventsListener 处理（仅已发布帖）
    if (subthread.thread.published) {
      this.eventEmitter.emit('post.created', {
        postId: post.id,
        content: dto.content,
        userId,
        authorUsername: post.author.username,
        threadId: subthread.threadId,
        subthreadId: subthread.id,
        subthreadTitle: subthread.title,
        parentPostId: dto.parentPostId ?? null,
        replyToPostId: dto.replyToPostId ?? null,
        isSubthreadBody: false,
      });
    }

    // 发帖人自己的阅读进度自动推进到此处（发帖即证明读到这里）
    this.readingProgressService.update(userId, subthreadId, post.id).catch((err) => {
      this.logger.error(`发帖后进度更新失败 userId=${userId} subthreadId=${subthreadId}`, err);
    });

    return post;
  }

  /** 编辑帖子 */
  async update(id: string, dto: UpdatePostDto, userId: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, authorId: true, threadId: true, content: true, subthread: { select: { deletedAt: true } } },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.authorId !== userId) throw forbidden('只能编辑自己的帖子');

    const oldContent = postLight.content;

    const updated = await this.prisma.post.update({
      where: { id, version: dto.version, ...notDeleted },
      data: { content: dto.content, version: { increment: 1 } },
      include: { author: { select: authorSelect } },
    }).catch((err) => { if (err?.code === 'P2025') throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, '帖子已被编辑，请刷新后重试', HttpStatus.CONFLICT); throw err; });

    // 编辑新增 @提及通知：对比新旧正文，仅对新增的 @用户名创建提及和通知
    if (dto.content !== oldContent) {
      const oldNames = new Set(this.mentionsService.extractUsernames(oldContent));
      const newNames = this.mentionsService.extractUsernames(dto.content).filter(n => !oldNames.has(n));
      if (newNames.length > 0 && postLight.threadId) {
        // 构造仅含新增 @用户名 的正文片段以复用 parseAndCreate 逻辑
        const fakeContent = newNames.map(n => `@${n}`).join(' ');
        this.mentionsService.parseAndCreate(updated.id, fakeContent, userId, postLight.threadId)
          .then(async (mentioned) => {
            if (mentioned.length > 0) {
              const blockSets = await this.blockFilter.loadBlockSets(userId);
              const filteredIds = this.blockFilter.filterRecipients(
                mentioned.map(u => u.userId), blockSets,
              );
              if (filteredIds.length === 0) return;
              const preview = truncateMarkdown(dto.content);
              this.notificationProducer.notify(
                'mention',
                filteredIds,
                `${updated.author.username} 在编辑后的帖子里提到了你：${preview}`,
                { postId: updated.id, threadId: postLight.threadId, fromUserId: userId,
                  payload: { actorName: updated.author.username, action: 'mention', preview } },
              ).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    // 缓存失效事件
    this.eventEmitter.emit('post.updated', {
      postId: updated.id,
      threadId: postLight.threadId,
      parentPostId: updated.parentPostId,
    });

    return updated;
  }

  /** 软删除帖子 */
  async remove(id: string, userId: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, authorId: true, floorNumber: true, parentPostId: true, threadId: true, subthread: { select: { deletedAt: true, bodyPostId: true } } },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.authorId !== userId) throw forbidden('只能删除自己的帖子');

    // 检查是否是子贴主体正文
    const isBodyPost = postLight.subthread.bodyPostId
      ? postLight.id === postLight.subthread.bodyPostId
      : postLight.floorNumber === 1 && !postLight.parentPostId;
    if (isBodyPost) {
      throw forbidden(
        '主体正文不可删除。如需修改请编辑帖子；如需移除请删除整个子贴。',
      );
    }

    const result = await this.prisma.post.update({
      where: { id, ...notDeleted },
      data: { deletedAt: new Date() },
    });

    // 缓存失效 + 有序集合更新
    this.eventEmitter.emit('post.deleted', {
      postId: id,
      threadId: postLight.threadId,
      parentPostId: postLight.parentPostId,
    });

    return result;
  }

  /** 获取单条帖子 + 导航上下文。已软删子贴返回 404 */
  async findById(id: string, userId?: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, threadId: true, subthread: { select: { deletedAt: true } } },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(postLight.threadId, userId);

    const post = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        thread: { select: { id: true, title: true } },
        subthread: { select: { id: true, title: true } },
        parentPost: { select: { id: true, floorNumber: true } },
        ...countNonDeletedReplies(),
      },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    return post;
  }

  /** 点赞：先查是否已存在，仅在首次点赞时递增 likeCount，保证幂等 */
  async like(id: string, userId: string, username: string) {
    const post = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, threadId: true, authorId: true, content: true, likeCount: true },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(post.threadId, userId);

    // 检查是否已点赞，已点赞则直接返回不重复递增
    const existing = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId: id, userId } },
    });
    if (existing) return post;

    await this.prisma.postLike.create({ data: { postId: id, userId } });

    const updated = await this.prisma.post.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    });

    // Redis 点赞计数器同步递增
    this.redis.hincrby(`post:${id}:stats`, 'likes', 1).catch(() => {});

    // 点赞通知（不通知自己赞自己，且排除拉黑关系）
    if (post.authorId !== userId) {
      const blockSets = await this.blockFilter.loadBlockSets(userId);
      const filtered = this.blockFilter.filterRecipients([post.authorId], blockSets);
      if (filtered.length > 0) {
        const preview = truncateMarkdown(post.content);
        this.notificationProducer.notify(
          'like',
          [post.authorId],
          `${username} 赞了你的帖子：${preview}`,
          { postId: id, threadId: post.threadId, fromUserId: userId,
            payload: { actorName: username, action: 'like', preview } },
        ).catch(() => {});
      }
    }

    // 缓存失效事件
    this.eventEmitter.emit('post.liked', { postId: id, threadId: post.threadId });

    return updated;
  }

  /** 取消点赞：仅在确实存在点赞记录时递减 likeCount，防止变负 */
  async unlike(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id, ...notDeleted } });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(post.threadId, userId);

    // 仅在存在点赞记录时删除并递减
    const result = await this.prisma.postLike.deleteMany({
      where: { postId: id, userId },
    });
    if (result.count === 0) return post;

    const updated = await this.prisma.post.update({
      where: { id },
      data: { likeCount: { increment: -1 } },
    });

    // Redis 点赞计数器同步递减
    this.redis.hincrby(`post:${id}:stats`, 'likes', -1).catch(() => {});

    // 缓存失效事件
    this.eventEmitter.emit('post.unliked', { postId: id, threadId: post.threadId });

    return updated;
  }
}
