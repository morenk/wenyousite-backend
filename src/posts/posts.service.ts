import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';

/** 楼层服务：发帖（事务楼层编号）、楼中楼、编辑、软删除 */
@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private threadAccess: ThreadAccessService,
  ) {}

  /** 获取子贴的楼层列表（Cursor 分页） */
  async findAllBySubthread(subthreadId: string, cursor?: string, limit = 20, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId },
      select: { id: true, threadId: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertAccessible(subthread.threadId, userId);

    const take = Math.min(limit, 50);
    const posts = await this.prisma.post.findMany({
      where: { subthreadId, parentPostId: null, deletedAt: null },
      orderBy: { floorNumber: 'asc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
        _count: { select: { replies: true } },
      },
    });

    const hasMore = posts.length > take;
    if (hasMore) posts.pop();

    return paginate(posts, {
      cursor: posts.length > 0 ? posts[posts.length - 1].id : null,
      hasMore,
    });
  }

  /** 获取楼中楼回复列表（cursor 分页，用于无限下拉） */
  async findReplies(postId: string, cursor?: string, limit = 20, userId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, threadId: true },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    await this.threadAccess.assertAccessible(post.threadId, userId);

    const take = Math.min(limit, 50);
    const replies = await this.prisma.post.findMany({
      where: { parentPostId: postId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
        replyToPost: { select: { id: true, authorId: true } },
      },
    });
    const hasMore = replies.length > take;
    if (hasMore) replies.pop();
    return paginate(replies, { cursor: replies.length > 0 ? replies[replies.length - 1].id : null, hasMore });
  }

  /** 发帖：楼层或楼中楼回复 */
  async create(subthreadId: string, dto: CreatePostDto, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId },
      include: { thread: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');

    // 自动加入主题帖
    await this.prisma.threadMember.upsert({
      where: { threadId_userId: { threadId: subthread.threadId, userId } },
      create: { threadId: subthread.threadId, userId, role: 'PARTICIPANT' },
      update: {},
    });

    // 检查发帖权限
    if (subthread.postingPolicy === 'COLLABORATORS') {
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId: subthread.threadId, userId } },
      });
      if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
        throw forbidden('该子贴仅限协作者发帖', ErrorCode.NOT_COLLABORATOR);
      }
    } else if (subthread.postingPolicy === 'PLAYERS') {
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId: subthread.threadId, userId } },
      });
      if (!member || !member.playerMarked) {
        throw forbidden('该子贴仅限玩家发帖', ErrorCode.NOT_PLAYER);
      }
    }

    // 验证 parentPost 存在
    if (dto.parentPostId) {
      const parent = await this.prisma.post.findUnique({ where: { id: dto.parentPostId } });
      if (!parent) throw notFound(ErrorCode.POST_NOT_FOUND, '父楼层不存在');
    }

    // 验证 replyToPost 存在且属于同一子贴
    if (dto.replyToPostId) {
      const target = await this.prisma.post.findUnique({
        where: { id: dto.replyToPostId },
        select: { id: true, subthreadId: true },
      });
      if (!target) throw notFound(ErrorCode.POST_NOT_FOUND, '被回复的帖子不存在');
      if (target.subthreadId !== subthreadId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
      }
    }

    // 事务：分配楼层编号 + 创建帖子 + 更新 lastPostAt
    const post = await this.prisma.$transaction(async (tx) => {
      let floorNumber: number | null = null;

      if (!dto.parentPostId) {
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
          author: { select: { id: true, username: true, nickname: true, avatar: true } },
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
        threadId: subthread.threadId,
        subthreadId: subthread.id,
        subthreadTitle: subthread.title,
        parentPostId: dto.parentPostId ?? null,
        replyToPostId: dto.replyToPostId ?? null,
      });
    }

    return post;
  }

  /** 编辑帖子 */
  async update(id: string, dto: UpdatePostDto & { version?: number }, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id, deletedAt: null } });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (post.authorId !== userId) throw forbidden('只能编辑自己的帖子');

    return this.prisma.post.update({
      where: { id, version: dto.version },
      data: { content: dto.content, version: { increment: 1 } },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    }).catch(() => { throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, '帖子已被编辑，请刷新后重试', HttpStatus.CONFLICT); });
  }

  /** 软删除帖子 */
  async remove(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id, deletedAt: null } });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (post.authorId !== userId) throw forbidden('只能删除自己的帖子');

    // 检查是否是子贴主体正文
    if (post.floorNumber === 1 && !post.parentPostId) {
      throw forbidden(
        '主体正文不可删除。如需修改请编辑帖子；如需移除请删除整个子贴。',
      );
    }

    return this.prisma.post.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** 获取单条帖子 + 导航上下文（用于通知跳转"查看原帖"） */
  async findById(id: string, userId?: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, threadId: true },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(postLight.threadId, userId);

    const post = await this.prisma.post.findUnique({
      where: { id, deletedAt: null },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
        thread: { select: { id: true, title: true } },
        subthread: { select: { id: true, title: true } },
        parentPost: { select: { id: true, floorNumber: true } },
        _count: { select: { replies: true } },
      },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    return post;
  }

  async like(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id, deletedAt: null } });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');

    await this.prisma.postLike.upsert({
      where: { postId_userId: { postId: id, userId } },
      create: { postId: id, userId },
      update: {},
    });

    return this.prisma.post.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    });
  }

  async unlike(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id, deletedAt: null } });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');

    await this.prisma.postLike.deleteMany({
      where: { postId: id, userId },
    });

    return this.prisma.post.update({
      where: { id },
      data: { likeCount: { increment: -1 } },
    });
  }
}
