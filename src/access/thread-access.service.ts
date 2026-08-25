import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notFound, forbidden } from '../common/exceptions/business.exception';

/** 主题帖访问权限服务：可访问性校验 + 管理权限校验 */
@Injectable()
export class ThreadAccessService {
  constructor(private prisma: PrismaService) {}

  /** 校验主题帖是否可访问（软删除 / 未发布权限 / 私密帖准入） */
  async assertAccessible(
    threadId: string,
    userId?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const thread = await client.thread.findUnique({
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
      const member = await client.threadMember.findUnique({
        where: { threadId_userId: { threadId, userId } },
      });
      if (!member) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    }
  }

  /**
   * 在通知落库等批量边界按主题当前状态过滤收件人。
   * 私密帖只允许当前成员，草稿只允许楼主；删除目标不产生新通知。
   */
  async filterAccessibleUserIds(
    threadId: string,
    userIds: string[],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string[]> {
    const candidates = [...new Set(userIds)];
    if (candidates.length === 0) return [];

    const thread = await client.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: {
        ownerId: true,
        published: true,
        visibility: true,
        members: {
          where: { userId: { in: candidates } },
          select: { userId: true },
        },
      },
    });
    if (!thread) return [];
    if (!thread.published) return candidates.filter((userId) => userId === thread.ownerId);
    if (thread.visibility === 'PUBLIC') return candidates;

    const memberIds = new Set(thread.members.map((member) => member.userId));
    return candidates.filter((userId) => memberIds.has(userId));
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
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { ownerId: true, visibility: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (thread.ownerId !== userId) {
      if (thread.visibility === 'PRIVATE') {
        throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      }
      throw forbidden('仅楼主可执行此操作', ErrorCode.NOT_THREAD_OWNER);
    }
    return thread;
  }
}
