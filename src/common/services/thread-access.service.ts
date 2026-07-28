import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../exceptions/error-codes';
import { notFound } from '../exceptions/business.exception';

/** 主题帖访问权限校验：未发布帖仅 owner 可见、私密帖仅成员可见 */
@Injectable()
export class ThreadAccessService {
  constructor(private prisma: PrismaService) {}

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
}
