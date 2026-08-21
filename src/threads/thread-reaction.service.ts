import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ThreadAccessService } from '../access/thread-access.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notDeleted } from '../common/prisma-helpers';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';

/** 主题点赞命令边界：数据库计数与可靠事件在同一事务提交。 */
@Injectable()
export class ThreadReactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ThreadAccessService,
    private readonly outbox: OutboxService,
  ) {}

  async like(id: string, userId: string, username: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, published: true, ownerId: true, title: true, likeCount: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw new BusinessException(ErrorCode.BAD_REQUEST, '草稿暂不支持点赞');
    await this.access.assertAccessible(id, userId);

    const { updated } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.threadLike.createMany({
        data: [{ threadId: id, userId }],
        skipDuplicates: true,
      });
      if (result.count === 0) return { updated: thread };
      const updatedThread = await tx.thread.update({
        where: { id },
        data: { likeCount: { increment: 1 } },
      });
      const eventId = randomUUID();
      await this.outbox.enqueue(tx, {
        eventType: 'thread.liked',
        aggregateType: 'Thread',
        aggregateId: id,
        eventKey: `thread-liked:${id}:${userId}:${eventId}`,
        payload: {
          eventId,
          threadId: id,
          ownerId: thread.ownerId,
          threadTitle: thread.title ?? '未命名主题',
          userId,
          username: username || '有人',
          occurredAt: new Date().toISOString(),
        },
      });
      return { updated: updatedThread };
    });

    return { id: updated.id, likeCount: updated.likeCount };
  }

  async unlike(id: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, published: true, likeCount: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    const { updated } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.threadLike.deleteMany({ where: { threadId: id, userId } });
      if (result.count === 0) return { updated: thread };
      const updatedThread = await tx.thread.update({
        where: { id },
        data: { likeCount: { decrement: 1 } },
      });
      const eventId = randomUUID();
      await this.outbox.enqueue(tx, {
        eventType: 'thread.unliked',
        aggregateType: 'Thread',
        aggregateId: id,
        eventKey: `thread-unliked:${id}:${userId}:${eventId}`,
        payload: { eventId, threadId: id },
      });
      return { updated: updatedThread };
    });
    return { id: updated.id, likeCount: updated.likeCount };
  }
}
