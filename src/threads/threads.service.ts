import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';

/** 主题帖服务：CRUD、事务创建、分区列表与排序 */
@Injectable()
export class ThreadsService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private notificationProducer: NotificationProducer,
  ) {}

  /** 创建主题帖：事务内创建 Thread + 第一个 Subthread + 第一楼 Post + OWNER 成员 */
  async create(dto: CreateThreadDto, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const thread = await tx.thread.create({
        data: {
          title: dto.title,
          category: dto.category,
          ownerId: userId,
          visibility: dto.visibility ?? 'PUBLIC',
        } as any,
      });

      const subthread = await tx.subthread.create({
        data: {
          threadId: thread.id,
          title: dto.title,
          sortOrder: 0,
        },
      });

      await tx.post.create({
        data: {
          threadId: thread.id,
          subthreadId: subthread.id,
          authorId: userId,
          floorNumber: 1,
          content: dto.content,
        },
      });

      await tx.threadMember.create({
        data: {
          threadId: thread.id,
          userId: userId,
          role: 'OWNER',
        },
      });

      if (dto.tagNames && dto.tagNames.length > 0) {
        const tags = await this.tagsService.findOrCreate(dto.tagNames);
        await tx.threadTopicTag.createMany({
          data: tags.map((tag) => ({ threadId: thread.id, tagId: tag.id })),
        });
      }

      return tx.thread.findUnique({
        where: { id: thread.id },
        include: {
          owner: { select: { id: true, username: true, nickname: true, avatar: true } },
          subthreads: {
            orderBy: { sortOrder: 'asc' },
            include: {
              _count: { select: { posts: true } },
              tags: { include: { tag: true } },
            },
          },
          topicTags: { include: { tag: true } },
          _count: { select: { members: true, posts: true } },
        },
      });
    });

    // 通知粉丝：创建者所有粉丝收到新主题帖通知
    const followers = await this.prisma.userFollow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
    });
    const followerIds = followers.map(f => f.followerId);
    if (followerIds.length > 0) {
      this.notificationProducer.notify(
        'thread_created',
        followerIds,
        `你关注的用户创建了新主题帖`,
        { postId: result!.id, threadId: result!.id, fromUserId: userId },
      ).catch(() => {});
    }

    return result;
  }

  /** 详情：主题帖 + 子贴列表。私密帖非成员返回 404 */
  async findById(id: string, userId?: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, username: true, nickname: true, avatar: true } },
        subthreads: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: { select: { posts: true } },
            tags: { include: { tag: true } },
          },
        },
        topicTags: { include: { tag: true } },
        _count: { select: { members: true, posts: true } },
      },
    });
    if (!thread) throw new NotFoundException('主题帖不存在');

    // 私密帖权限：仅成员可访问
    if (thread.visibility === 'PRIVATE') {
      if (!userId) throw new NotFoundException('主题帖不存在');
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId: id, userId } },
      });
      if (!member) throw new NotFoundException('主题帖不存在');
    }

    this.prisma.thread.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    }).catch(() => {});

    return thread;
  }

  /** 分区列表：支持推荐/最新/活跃排序 + 标签筛选 + Cursor 分页 */
  async findAll(query: ThreadQueryDto) {
    const where: any = { deletedAt: null, visibility: 'PUBLIC' };
    if (query.category) where.category = query.category;
    if (query.tag) {
      where.topicTags = {
        some: { tag: { name: { contains: query.tag, mode: 'insensitive' } } },
      };
    }

    const take = Math.min(query.limit ?? 20, 50);
    const orderBy: any[] = [{ pinned: 'desc' }, { createdAt: 'desc' }];

    if (query.sort === 'active') {
      orderBy[1] = { updatedAt: 'desc' };
    }

    const threads = await this.prisma.thread.findMany({
      where,
      orderBy,
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        owner: { select: { id: true, username: true, nickname: true, avatar: true } },
        subthreads: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { id: true, title: true, lastPostAt: true },
        },
        topicTags: { include: { tag: true } },
        _count: { select: { members: true, posts: true } },
      },
    });

    const hasMore = threads.length > take;
    if (hasMore) threads.pop();

    return {
      items: threads,
      pagination: {
        cursor: threads.length > 0 ? threads[threads.length - 1].id : null,
        hasMore,
      },
    };
  }

  /** 修改主题帖（仅 OWNER/COLLABORATOR） */
  async update(id: string, dto: UpdateThreadDto & { version?: number }, userId: string) {
    await this.assertCanManage(id, userId);
    const { version, ...data } = dto;
    return this.prisma.thread.update({
      where: { id, version },
      data: { ...data, version: { increment: 1 } } as any,
    }).catch(() => { throw new NotFoundException('主题帖已被修改，请刷新后重试'); });
  }

  /** 软删除（仅 OWNER） */
  async remove(id: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id } });
    if (!thread) throw new NotFoundException('主题帖不存在');
    if (thread.ownerId !== userId) throw new ForbiddenException('仅楼主可删除主题帖');

    return this.prisma.thread.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** 检查当前用户是否有管理权限（OWNER 或 COLLABORATOR） */
  async assertCanManage(threadId: string, userId: string) {
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
      throw new ForbiddenException('无管理权限');
    }
    return member;
  }

  /** 生成或刷新私密帖邀请链接（仅 OWNER，且帖子为 PRIVATE） */
  async createInviteLink(threadId: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('主题帖不存在');
    if (thread.ownerId !== userId) throw new ForbiddenException('仅楼主可管理邀请链接');
    if (thread.visibility !== 'PRIVATE') throw new ForbiddenException('仅私密帖可生成邀请链接');

    return this.prisma.threadInvite.upsert({
      where: { threadId },
      create: { threadId, token: this.generateToken() },
      update: { token: this.generateToken() },
    });
  }

  /** 通过邀请链接加入私密帖 */
  async joinByInviteLink(token: string, userId: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: { thread: { select: { id: true, visibility: true } } },
    });
    if (!invite) throw new NotFoundException('邀请链接无效或已失效');
    if (invite.thread.visibility !== 'PRIVATE') throw new ForbiddenException('该主题帖为公开帖，可直接加入');

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: invite.threadId, userId } },
    });
    if (existing) throw new ConflictException('已是该主题帖成员');

    return this.prisma.threadMember.create({
      data: { threadId: invite.threadId, userId, role: 'PARTICIPANT' },
      include: {
        thread: { select: { id: true, title: true } },
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });
  }

  /** 生成随机邀请 token */
  private generateToken(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 16; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
