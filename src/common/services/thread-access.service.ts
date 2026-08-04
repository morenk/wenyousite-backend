import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../exceptions/error-codes';
import { notFound, forbidden } from '../exceptions/business.exception';

/** 主题帖访问权限服务：可访问性校验 + 管理权限校验 */
@Injectable()
export class ThreadAccessService {
  constructor(private prisma: PrismaService) {}

  /** 校验主题帖是否可访问（软删除 / 未发布权限 / 私密帖准入） */
  async assertAccessible(threadId: string, userId?: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { visibility: true, published: true, ownerId: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    if (!thread.published) {
      if (!userId || thread.ownerId !== userId) {
        throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      }
      return;
    }

    if (thread.visibility === 'PRIVATE') {
      if (!userId) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId, userId } },
      });
      if (!member) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    }
  }

  /** 校验管理权限：OWNER 或 COLLABORATOR，否则 403 */
  async assertCanManage(threadId: string, userId: string) {
    await this.assertAccessible(threadId, userId);
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
      throw forbidden('无管理权限');
    }
    return member;
  }

  /** 校验楼主专属权限，并隐藏已删除或不可访问的主题帖。 */
  async assertOwner(threadId: string, userId: string) {
    await this.assertAccessible(threadId, userId);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!thread || thread.ownerId !== userId) {
      throw forbidden('仅楼主可执行此操作', ErrorCode.NOT_THREAD_OWNER);
    }
    return thread;
  }
}
