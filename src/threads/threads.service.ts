import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';

/** 主题帖服务：草稿创建、沙盒迭代、发布、CRUD */
@Injectable()
export class ThreadsService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private notificationProducer: NotificationProducer,
  ) {}

  /** 创建主题帖草稿：仅创建 Thread(published=false) + OWNER 成员 */
  async create(dto: CreateThreadDto, userId: string) {
    const thread = await this.prisma.thread.create({
      data: {
        title: dto.title,
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
      where: { id: thread.id },
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
  }

  /** 我的草稿列表（未发布帖） */
  async findDrafts(userId: string) {
    return this.prisma.thread.findMany({
      where: { ownerId: userId, published: false, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        subthreads: {
          where: { deletedAt: null },
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
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    // 未发布帖：仅 owner 可访问
    if (!thread.published) {
      if (!userId || thread.ownerId !== userId) {
        throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      }
    }

    // 私密帖权限：仅成员可访问
    if (thread.visibility === 'PRIVATE' && thread.published) {
      if (!userId) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId: id, userId } },
      });
      if (!member) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    }

    // 浏览量 +1（仅已发布帖）
    if (thread.published) {
      this.prisma.thread.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      }).catch(() => {});
    }

    return thread;
  }

  /** 分区列表：仅返回已发布帖 */
  async findAll(query: ThreadQueryDto, userId?: string) {
    const where: any = { deletedAt: null, published: true };

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

    return paginate(threads, {
      cursor: threads.length > 0 ? threads[threads.length - 1].id : null,
      hasMore,
    });
  }

  /** 修改主题帖（仅 OWNER/COLLABORATOR）。published=true 触发发布 */
  async update(id: string, dto: UpdateThreadDto & { version?: number }, userId: string) {
    const member = await this.assertCanManage(id, userId);
    const { version, published, ...data } = dto;

    // 发布校验
    if (published === true) {
      const thread = await this.prisma.thread.findUnique({
        where: { id },
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
      where: { id, version },
      data: updateData,
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
    }).catch(() => {
      throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, '主题帖已被修改，请刷新后重试', HttpStatus.CONFLICT);
    });

    // 发布后通知粉丝
    if (published === true) {
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
    const thread = await this.prisma.thread.findUnique({ where: { id } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (thread.ownerId !== userId) throw forbidden('仅楼主可删除主题帖', ErrorCode.NOT_THREAD_OWNER);

    if (!thread.published) {
      return this.prisma.thread.delete({ where: { id } });
    }

    return this.prisma.thread.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** 校验发布前完整性 */
  async validatePublishReadiness(threadId: string, title: string, category: string) {
    if (!title || title.trim().length === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主题帖标题后再发布');
    }
    if (!category) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择分区后再发布');
    }

    const subthread = await this.prisma.subthread.findFirst({
      where: { threadId, deletedAt: null },
      include: {
        posts: {
          where: { deletedAt: null },
          take: 1,
        },
      },
      orderBy: { sortOrder: 'asc' },
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
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
      throw forbidden('无管理权限');
    }
    return member;
  }

  /** 生成或刷新私密帖邀请链接（仅 OWNER，已发布 + 私密帖） */
  async createInviteLink(threadId: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
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
      include: { thread: { select: { id: true, visibility: true, published: true } } },
    });
    if (!invite) throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    if (!invite.thread.published) throw forbidden('该主题帖尚未发布');
    if (invite.thread.visibility !== 'PRIVATE') throw forbidden('该主题帖为公开帖，可直接加入');

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: invite.threadId, userId } },
    });
    if (existing) throw new BusinessException(ErrorCode.ALREADY_MEMBER, '已是该主题帖成员', HttpStatus.CONFLICT);

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
