import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

/** 楼层服务：发帖（事务楼层编号）、楼中楼、编辑、软删除 */
@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  /** 获取子贴的楼层列表（Cursor 分页） */
  async findAllBySubthread(subthreadId: string, cursor?: string, limit = 20) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id: subthreadId } });
    if (!subthread) throw new NotFoundException('子贴不存在');

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

    return {
      items: posts,
      pagination: {
        cursor: posts.length > 0 ? posts[posts.length - 1].id : null,
        hasMore,
      },
    };
  }

  /** 获取楼中楼回复列表（cursor 分页，用于无限下拉） */
  async findReplies(postId: string, cursor?: string, limit = 20) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('楼层不存在');

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
    return { items: replies, pagination: { cursor: replies.length > 0 ? replies[replies.length - 1].id : null, hasMore } };
  }

  /** 发帖：楼层或楼中楼回复 */
  async create(subthreadId: string, dto: CreatePostDto, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId },
      include: { thread: true },
    });
    if (!subthread) throw new NotFoundException('子贴不存在');

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
        throw new ForbiddenException('该子贴仅限协作者发帖');
      }
    }

    // 验证 parentPost 存在
    if (dto.parentPostId) {
      const parent = await this.prisma.post.findUnique({ where: { id: dto.parentPostId } });
      if (!parent) throw new NotFoundException('父楼层不存在');
    }

    // 验证 replyToPost 存在
    if (dto.replyToPostId) {
      const target = await this.prisma.post.findUnique({ where: { id: dto.replyToPostId } });
      if (!target) throw new NotFoundException('被回复的帖子不存在');
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

    // 发帖后通过事件解耦：@提及、通知由 PostEventsListener 处理
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

    return post;
  }

  /** 编辑帖子 */
  async update(id: string, dto: UpdatePostDto & { version?: number }, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('帖子不存在');
    if (post.authorId !== userId) throw new ForbiddenException('只能编辑自己的帖子');

    return this.prisma.post.update({
      where: { id, version: dto.version },
      data: { content: dto.content, version: { increment: 1 } },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    }).catch(() => { throw new NotFoundException('帖子已被编辑，请刷新后重试'); });
  }

  /** 软删除帖子 */
  async remove(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('帖子不存在');
    if (post.authorId !== userId) throw new ForbiddenException('只能删除自己的帖子');

    // 检查是否是子贴第一楼
    if (post.floorNumber === 1 && !post.parentPostId) {
      throw new ForbiddenException(
        '这是子贴正文，删除将同时删除整个子贴。请使用子贴管理功能进行删除。',
      );
    }

    return this.prisma.post.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** 获取单条帖子 + 导航上下文（用于通知跳转"查看原帖"） */
  async findById(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
        thread: { select: { id: true, title: true } },
        subthread: { select: { id: true, title: true } },
        parentPost: { select: { id: true, floorNumber: true } },
        _count: { select: { replies: true } },
      },
    });
    if (!post) throw new NotFoundException('帖子不存在');
    return post;
  }
}
