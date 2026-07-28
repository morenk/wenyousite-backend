import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { CreateSubthreadDto } from './dto/create-subthread.dto';
import { UpdateSubthreadDto } from './dto/update-subthread.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';

/** 子贴服务：CRUD、排序、权限校验 */
@Injectable()
export class SubthreadsService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
  ) {}

  /** 获取主题帖下的子贴列表 */
  async findAll(threadId: string, userId?: string) {
    await this.threadAccess.assertAccessible(threadId, userId);

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
    await this.threadAccess.assertAccessible(subthread.threadId, userId);
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

  /** 软删除子贴（仅 OWNER/COLLABORATOR）。默认子贴不可单独删除 */
  async remove(id: string, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id } });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    if (subthread.deletedAt) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.assertCanManage(subthread.threadId, userId);

    // 默认子贴：主题帖创建时同步生成的第一个子贴，是主题帖主内容区，不可单独删除
    const firstSubthread = await this.prisma.subthread.findFirst({
      where: { threadId: subthread.threadId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (firstSubthread?.id === id) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '默认子贴不可单独删除，请删除整个主题帖',
        HttpStatus.BAD_REQUEST,
      );
    }

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
