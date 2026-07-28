import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubthreadDto } from './dto/create-subthread.dto';
import { UpdateSubthreadDto } from './dto/update-subthread.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';

/** 子贴服务：CRUD、排序、权限校验 */
@Injectable()
export class SubthreadsService {
  constructor(private prisma: PrismaService) {}

  /** 检查主题帖可见性：私密帖仅成员可访问，否则 404 */
  private async assertThreadVisible(threadId: string, userId?: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { visibility: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (thread.visibility === 'PRIVATE') {
      if (!userId) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId, userId } },
      });
      if (!member) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    }
  }

  /** 获取主题帖下的子贴列表 */
  async findAll(threadId: string, userId?: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, visibility: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    await this.assertThreadVisible(threadId, userId);

    return this.prisma.subthread.findMany({
      where: { threadId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { posts: true } },
      },
    });
  }

  /** 获取单个子贴详情 */
  async findById(id: string, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id },
      include: {
        thread: { select: { id: true, title: true, ownerId: true, visibility: true } },
        tags: { include: { tag: true } },
        _count: { select: { posts: true } },
      },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.assertThreadVisible(subthread.threadId, userId);
    return subthread;
  }

  /** 创建子贴（仅 OWNER/COLLABORATOR），事务内创建子贴 + 第一楼 */
  async create(threadId: string, dto: CreateSubthreadDto, userId: string) {
    await this.assertCanManage(threadId, userId);

    return this.prisma.$transaction(async (tx) => {
      const subthread = await tx.subthread.create({
        data: {
          threadId,
          title: dto.title,
          sortOrder: dto.sortOrder ?? 0,
          postingPolicy: dto.postingPolicy ?? 'PARTICIPANTS' as any,
        },
      });

      await tx.post.create({
        data: {
          threadId,
          subthreadId: subthread.id,
          authorId: userId,
          floorNumber: 1,
          content: dto.content,
        },
      });

      return tx.subthread.findUnique({
        where: { id: subthread.id },
        include: {
          tags: { include: { tag: true } },
          _count: { select: { posts: true } },
        },
      });
    });
  }

  /** 修改子贴（仅 OWNER/COLLABORATOR） */
  async update(id: string, dto: UpdateSubthreadDto & { version?: number }, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id } });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.assertCanManage(subthread.threadId, userId);

    const { version, ...data } = dto;
    return this.prisma.subthread.update({
      where: { id, version },
      data: { ...data, version: { increment: 1 } } as any,
      include: {
        tags: { include: { tag: true } },
        _count: { select: { posts: true } },
      },
    }).catch(() => { throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, '子贴已被修改，请刷新后重试', HttpStatus.CONFLICT); });
  }

  /** 软删除子贴（仅 OWNER/COLLABORATOR） */
  async remove(id: string, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id } });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    if (subthread.deletedAt) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.assertCanManage(subthread.threadId, userId);

    return this.prisma.subthread.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** 检查是否有管理权限（公开方法，供标签控制器调用） */
  async assertCanManage(threadId: string, userId: string) {
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
      throw forbidden('仅楼主和协作者可管理子贴');
    }
    return member;
  }
}
