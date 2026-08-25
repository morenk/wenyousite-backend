import { Injectable } from '@nestjs/common';
import { ContentRemovalSource } from '@prisma/client';
import { ThreadAccessService } from '../access/thread-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationJob } from './notification.producer';

/**
 * 通知是私密内容最容易遗漏的旁路，因此在最终落库和推送前再次验证目标与收件人。
 * 上游即使误算了订阅者、粉丝或提及候选，也不能越过这一层泄露内容存在性。
 */
@Injectable()
export class NotificationEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
  ) {}

  async filterRecipients(job: NotificationJob): Promise<string[]> {
    const recipients = [...new Set(job.recipients)];
    if (recipients.length === 0) return [];

    if (job.postId) {
      const post = await this.prisma.post.findUnique({
        where: { id: job.postId },
        select: {
          threadId: true,
          deletedAt: true,
          parentPost: { select: { deletedAt: true } },
          subthread: { select: { deletedAt: true } },
          thread: { select: { deletedAt: true } },
        },
      });
      if (
        !post ||
        post.deletedAt ||
        post.parentPost?.deletedAt ||
        post.subthread.deletedAt ||
        post.thread.deletedAt ||
        (job.threadId && job.threadId !== post.threadId)
      ) {
        return [];
      }
      return this.threadAccess.filterAccessibleUserIds(post.threadId, recipients);
    }

    if (job.momentCommentId) {
      const comment = await this.prisma.momentComment.findUnique({
        where: { id: job.momentCommentId },
        select: {
          momentId: true,
          deletedAt: true,
          moment: { select: { deletedAt: true } },
          parentComment: { select: { deletedAt: true, removalSource: true } },
        },
      });
      if (
        !comment ||
        comment.deletedAt ||
        comment.moment.deletedAt ||
        (comment.parentComment?.deletedAt &&
          comment.parentComment.removalSource === ContentRemovalSource.ADMIN) ||
        (job.momentId && job.momentId !== comment.momentId)
      ) {
        return [];
      }
      return recipients;
    }

    if (job.momentId) {
      const moment = await this.prisma.moment.findUnique({
        where: { id: job.momentId },
        select: { deletedAt: true },
      });
      return moment && !moment.deletedAt ? recipients : [];
    }

    if (job.threadId) {
      return this.threadAccess.filterAccessibleUserIds(job.threadId, recipients);
    }

    return recipients;
  }
}
