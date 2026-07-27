import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';

/** 主题帖服务：CRUD、事务创建、分区列表与排序 */
@Injectable()
export class ThreadsService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
  ) {}

  /** 创建主题帖：事务内创建 Thread + 第一个 Subthread + 第一楼 Post + OWNER 成员 */
  async create(dto: CreateThreadDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const thread = await tx.thread.create({
        data: {
          title: dto.title,
          category: dto.category,
          ownerId: userId,
        },
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

      // 处理主题帖标签
      if (dto.tagNames && dto.tagNames.length > 0) {
        const tags = await this.tagsService.findOrCreate(dto.tagNames);
        await tx.threadTopicTag.createMany({
          data: tags.map((tag) => ({ threadId: thread.id, tagId: tag.id })),
        });
      }

      // 返回完整数据（在事务内查询，避免提交后查不到）
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
  }

  /** 详情：主题帖 + 子贴列表 */
  async findById(id: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, deletedAt: null },
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
    if (!thread) throw new NotFoundException('主题帖不存在');
    return thread;
  }

  /** 分区列表：支持推荐/最新/活跃排序 + 标签筛选 + Cursor 分页 */
  async findAll(query: ThreadQueryDto) {
    const where: any = { deletedAt: null };
    if (query.category) where.category = query.category;
    if (query.tag) {
      where.topicTags = {
        some: { tag: { name: { contains: query.tag, mode: 'insensitive' } } },
      };
    }

    const take = Math.min(query.limit ?? 20, 50);
    const orderBy: any = { createdAt: 'desc' };

    if (query.sort === 'active') {
      // 按最后回复活跃度排序：简单实现为最近创建的子贴楼层有更新的在前
      // 实际推荐算法在 1.0 版本中先用创建时间倒序替代
      orderBy.updatedAt = 'desc';
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
      data: { ...data, version: { increment: 1 } },
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
}
