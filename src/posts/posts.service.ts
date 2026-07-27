import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

/** 楼层服务：发帖（事务楼层编号）、楼中楼、编辑、软删除 */
@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService) {}

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

  /** 获取楼中楼回复列表（平级，按创建时间排序） */
  async findReplies(postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('楼层不存在');

    return this.prisma.post.findMany({
      where: { parentPostId: postId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
        replyToPost: {
          select: { id: true, authorId: true },
        },
      },
    });
  }

  /** 发帖：楼层或楼中楼回复 */
  async create(subthreadId: string, dto: CreatePostDto, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId },
      include: { thread: true },
    });
    if (!subthread) throw new NotFoundException('子贴不存在');

    // 自动加入主题帖（如还不是成员）
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

    // 验证 parentPost 存在（如果是楼中楼）
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
    return this.prisma.$transaction(async (tx) => {
      let floorNumber: number | null = null;

      if (!dto.parentPostId) {
        // 新楼层：分配楼层编号
        const maxFloor = await tx.post.aggregate({
          where: { subthreadId, parentPostId: null },
          _max: { floorNumber: true },
        });
        floorNumber = (maxFloor._max.floorNumber ?? 0) + 1;
      }

      const post = await tx.post.create({
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

      // 更新子贴的最后回复时间
      await tx.subthread.update({
        where: { id: subthreadId },
        data: { lastPostAt: new Date() },
      });

      return post;
    });
  }

  /** 编辑帖子 */
  async update(id: string, dto: UpdatePostDto, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('帖子不存在');
    if (post.authorId !== userId) throw new ForbiddenException('只能编辑自己的帖子');

    return this.prisma.post.update({
      where: { id },
      data: { content: dto.content },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });
  }

  /** 软删除帖子 */
  async remove(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('帖子不存在');
    if (post.authorId !== userId) throw new ForbiddenException('只能删除自己的帖子');

    // 检查是否是子贴第一楼（floorNumber === 1 且 parentPostId === null）
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

  /** 获取单条帖子 */
  async findById(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true } },
        _count: { select: { replies: true } },
      },
    });
    if (!post) throw new NotFoundException('帖子不存在');
    return post;
  }
}
