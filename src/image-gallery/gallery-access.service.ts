import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { MomentAccessService } from '../moments/moment-access.service';
import { visiblePostWhere, visibleUserWhere } from '../access/block-visibility.where';
import { notFound } from '../common/exceptions/business.exception';
import { GalleryScope } from './gallery.dto';
export type GalleryContext = {
  threadId: string | null;
  subthreadId: string | null;
  momentId: string | null;
  ownerId: string | null;
};
@Injectable()
export class GalleryAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threads: ThreadAccessService,
    private readonly moments: MomentAccessService,
  ) {}
  async assert(scope: GalleryScope, id: string, viewerId?: string): Promise<GalleryContext> {
    if (scope === GalleryScope.SUBTHREAD || scope === GalleryScope.POST_REPLIES) {
      const sub =
        scope === GalleryScope.SUBTHREAD
          ? await this.prisma.subthread.findFirst({
              where: { id, deletedAt: null },
              select: { id: true, threadId: true },
            })
          : (
              await this.prisma.post.findFirst({
                where: { id, kind: 'FLOOR', parentPostId: null, ...visiblePostWhere(viewerId) },
                select: { subthread: { select: { id: true, threadId: true } } },
              })
            )?.subthread;
      if (!sub) throw notFound();
      await this.threads.assertAccessible(sub.threadId, viewerId);
      const thread = await this.prisma.thread.findFirst({
        where: { id: sub.threadId, published: true, deletedAt: null },
        select: { ownerId: true },
      });
      // 草稿正文仅由编辑器查看，不经已发布图集接口读取。
      if (!thread) throw notFound();
      return {
        threadId: sub.threadId,
        subthreadId: sub.id,
        momentId: null,
        ownerId: thread.ownerId,
      };
    }
    let momentId = id;
    if (scope === GalleryScope.MOMENT_REPLIES) {
      const root = await this.prisma.momentComment.findFirst({
        where: {
          id,
          parentCommentId: null,
          author: visibleUserWhere(viewerId),
          NOT: { deletedAt: { not: null }, removalSource: 'ADMIN' },
        },
        select: { momentId: true },
      });
      if (!root) throw notFound();
      momentId = root.momentId;
    }
    await this.moments.assertVisible(momentId, viewerId);
    return { threadId: null, subthreadId: null, momentId, ownerId: null };
  }
  async eligibleAuthor(context: GalleryContext, authorId?: string) {
    if (!authorId || !context.threadId || authorId === context.ownerId) return true;
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: context.threadId, userId: authorId } },
      select: { role: true, playerMarked: true },
    });
    return Boolean(
      member?.playerMarked || member?.role === 'OWNER' || member?.role === 'COLLABORATOR',
    );
  }
  postWhere(scope: GalleryScope, scopeId: string, viewerId?: string): Prisma.PostWhereInput {
    return {
      ...visiblePostWhere(viewerId),
      ...(scope === GalleryScope.SUBTHREAD
        ? { subthreadId: scopeId, parentPostId: null }
        : { parentPostId: scopeId, kind: 'FLOOR' }),
    };
  }
}
