import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notDeleted } from '../common/prisma-helpers';

const MAX_PINNED_FLOORS = 10;

/** 主楼层置顶命令；锁定所属主题和子贴，避免并发突破置顶上限。 */
@Injectable()
export class PostPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
  ) {}

  async pin(id: string, userId: string) {
    await this.setPinned(id, userId, true);
  }

  async unpin(id: string, userId: string) {
    await this.setPinned(id, userId, false);
  }

  private async setPinned(id: string, userId: string, pinned: boolean) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: {
        id: true,
        threadId: true,
        subthreadId: true,
        kind: true,
        parentPostId: true,
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!postLight || postLight.subthread.deletedAt) {
      throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    }
    await this.threadAccess.assertCanManage(postLight.threadId, userId);

    if (postLight.kind !== 'FLOOR' || postLight.parentPostId !== null) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '只能置顶主楼层');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${postLight.threadId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM subthreads WHERE id = ${postLight.subthreadId} FOR UPDATE`;
      const thread = await tx.thread.findUnique({
        where: { id: postLight.threadId, ...notDeleted },
        select: { id: true },
      });
      if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

      const current = await tx.post.findUnique({
        where: { id, ...notDeleted },
        select: {
          id: true,
          kind: true,
          parentPostId: true,
          pinnedAt: true,
          subthread: { select: { deletedAt: true } },
        },
      });
      if (!current || current.subthread.deletedAt) {
        throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
      }
      if (current.kind !== 'FLOOR' || current.parentPostId !== null) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '只能置顶主楼层');
      }

      if (!pinned || current.pinnedAt) {
        if (pinned === Boolean(current.pinnedAt)) return;
        await tx.post.update({ where: { id }, data: { pinnedAt: null } });
        return;
      }

      const pinnedCount = await tx.post.count({
        where: {
          subthreadId: postLight.subthreadId,
          kind: 'FLOOR',
          parentPostId: null,
          pinnedAt: { not: null },
          ...notDeleted,
        },
      });
      if (pinnedCount >= MAX_PINNED_FLOORS) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `当前子贴最多置顶 ${MAX_PINNED_FLOORS} 个楼层`,
        );
      }
      await tx.post.update({ where: { id }, data: { pinnedAt: new Date() } });
    });
  }
}
