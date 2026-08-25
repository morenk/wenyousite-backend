import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { forbidden, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { authorSelect, notDeleted } from '../common/prisma-helpers';
import { PrismaService } from '../prisma/prisma.service';
import { mapThreadCategoryInfo, threadCategoryInfoSelect } from '../taxonomy/thread-category-info';
import { ThreadAccessService } from '../access/thread-access.service';

/** 私密主题邀请用例，隔离 token、成员加入和可见性规则。 */
@Injectable()
export class ThreadInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
  ) {}

  async create(threadId: string, userId: string) {
    await this.threadAccess.assertOwner(threadId, userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId, ...notDeleted } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw forbidden('请先发布主题帖');
    if (thread.visibility !== 'PRIVATE') throw forbidden('仅私密帖可生成邀请链接');

    return this.prisma.threadInvite.upsert({
      where: { threadId },
      create: { threadId, token: this.generateToken() },
      update: { token: this.generateToken() },
    });
  }

  async preview(token: string, userId?: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: {
        thread: {
          select: {
            id: true,
            title: true,
            category: true,
            categoryDefinition: { select: threadCategoryInfoSelect },
            status: true,
            visibility: true,
            published: true,
            deletedAt: true,
            createdAt: true,
            owner: { select: authorSelect },
          },
        },
      },
    });
    if (!invite || invite.thread.deletedAt) {
      throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    }
    if (!invite.thread.published || invite.thread.visibility !== 'PRIVATE') {
      throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    }

    const [memberCount, existingMember] = await Promise.all([
      this.prisma.threadMember.count({ where: { threadId: invite.threadId } }),
      userId
        ? this.prisma.threadMember.findUnique({
            where: { threadId_userId: { threadId: invite.threadId, userId } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      thread: {
        id: invite.thread.id,
        title: invite.thread.title,
        category: invite.thread.category,
        categoryInfo: mapThreadCategoryInfo(
          invite.thread.category,
          invite.thread.categoryDefinition,
        ),
        status: invite.thread.status,
        owner: invite.thread.owner,
        memberCount,
        createdAt: invite.thread.createdAt,
      },
      alreadyJoined: Boolean(existingMember),
    };
  }

  async join(token: string, userId: string) {
    const invite = await this.prisma.threadInvite.findUnique({
      where: { token },
      include: {
        thread: { select: { id: true, visibility: true, published: true, deletedAt: true } },
      },
    });
    if (!invite || invite.thread.deletedAt) {
      throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    }
    if (!invite.thread.published || invite.thread.visibility !== 'PRIVATE') {
      throw notFound(ErrorCode.INVITE_INVALID, '邀请链接无效或已失效');
    }

    return this.prisma.threadMember.upsert({
      where: { threadId_userId: { threadId: invite.threadId, userId } },
      create: { threadId: invite.threadId, userId, role: 'PARTICIPANT' },
      update: {},
      include: {
        thread: { select: { id: true, title: true } },
        user: { select: authorSelect },
      },
    });
  }

  private generateToken(): string {
    return randomBytes(16).toString('base64url').slice(0, 16);
  }
}
