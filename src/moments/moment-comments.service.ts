import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate } from '../common/dto/paginated-result';
import { hashIdempotencyPayload } from '../common/idempotency';
import { publicUserSummarySelect } from '../common/user-summary';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMomentCommentDto } from './dto/moment-write.dto';
import { mapMomentComment } from './moment.mapper';
import { MomentsService } from './moments.service';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { StickersService } from '../stickers/stickers.service';

type Viewer = { id: string; username?: string; role?: string };

const commentSelect = {
  id: true,
  momentId: true,
  authorId: true,
  author: { select: publicUserSummarySelect },
  content: true,
  media: {
    select: {
      id: true,
      url: true,
      status: true,
      width: true,
      height: true,
    },
  },
  sticker: {
    select: {
      id: true,
      url: true,
      thumbnailUrl: true,
      width: true,
      height: true,
      animated: true,
      frameCount: true,
      durationMs: true,
    },
  },
  parentCommentId: true,
  replyToComment: { select: { id: true, author: { select: publicUserSummarySelect } } },
  deletedAt: true,
  createdAt: true,
} satisfies Prisma.MomentCommentSelect;

@Injectable()
export class MomentCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moments: MomentsService,
    private readonly outbox: OutboxService,
    private readonly stickers: StickersService,
  ) {}

  async listRoots(
    momentId: string,
    cursor: string | undefined,
    limit = 20,
    viewer?: Viewer,
    order = ReplyOrder.NEWEST,
    authorId?: string,
  ) {
    const moment = await this.moments.assertVisible(momentId, viewer?.id);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    if (cursor) await this.assertCursor(cursor, momentId, true);
    const take = Math.min(limit, 30);
    const direction = order === ReplyOrder.NEWEST ? 'desc' : 'asc';
    const visibleReplyWhere = {
      deletedAt: null,
      ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
      ...(authorId ? { authorId } : {}),
    } satisfies Prisma.MomentCommentWhereInput;
    const rows = await this.prisma.momentComment.findMany({
      where: {
        momentId,
        parentCommentId: null,
        ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
        AND: [
          {
            OR: [
              { deletedAt: null },
              {
                replies: {
                  some: {
                    deletedAt: null,
                    ...(excludedAuthors.length
                      ? { authorId: { notIn: excludedAuthors } }
                      : {}),
                  },
                },
              },
            ],
          },
          ...(authorId
            ? [
                {
                  OR: [
                    { authorId, deletedAt: null },
                    { replies: { some: visibleReplyWhere } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: direction }, { id: direction }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: take + 1,
      select: {
        ...commentSelect,
        replies: {
          where: visibleReplyWhere,
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: 3,
          select: commentSelect,
        },
        _count: {
          select: {
            replies: { where: visibleReplyWhere },
          },
        },
      },
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return paginate(page.map((row) => ({
      ...mapMomentComment(row, viewer, moment.authorId),
      replyCount: row._count.replies,
      replies: row.replies.map((reply) => mapMomentComment(reply, viewer, moment.authorId)),
    })), {
      cursor: page.at(-1)?.id ?? null,
      hasMore,
    });
  }

  async listReplies(
    momentId: string,
    rootCommentId: string,
    cursor: string | undefined,
    limit = 20,
    viewer?: Viewer,
    order = ReplyOrder.OLDEST,
    authorId?: string,
  ) {
    const moment = await this.moments.assertVisible(momentId, viewer?.id);
    const root = await this.prisma.momentComment.findFirst({
      where: { id: rootCommentId, momentId, parentCommentId: null },
      select: { id: true },
    });
    if (!root) throw new NotFoundException('主评论不存在');
    if (cursor) await this.assertCursor(cursor, momentId, false, rootCommentId);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    const take = Math.min(limit, 50);
    const direction = order === ReplyOrder.NEWEST ? 'desc' : 'asc';
    const rows = await this.prisma.momentComment.findMany({
      where: {
        parentCommentId: rootCommentId,
        deletedAt: null,
        ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
        ...(authorId ? { authorId } : {}),
      },
      orderBy: [{ createdAt: direction }, { id: direction }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: take + 1,
      select: commentSelect,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return paginate(page.map((row) => mapMomentComment(row, viewer, moment.authorId)), {
      cursor: page.at(-1)?.id ?? null,
      hasMore,
    });
  }

  async listAuthors(momentId: string, viewer?: Viewer) {
    await this.moments.assertVisible(momentId, viewer?.id);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    const rows = await this.prisma.momentComment.findMany({
      where: {
        momentId,
        deletedAt: null,
        ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
      },
      distinct: ['authorId'],
      orderBy: { authorId: 'asc' },
      select: { author: { select: publicUserSummarySelect } },
    });
    return rows
      .map((row) => row.author)
      .sort((first, second) =>
        first.username.localeCompare(second.username, 'zh-CN') || first.id.localeCompare(second.id),
      );
  }

  async create(momentId: string, dto: CreateMomentCommentDto, viewer: Viewer) {
    const moment = await this.moments.assertVisible(momentId, viewer.id);
    const content = dto.content?.trim() ?? '';
    const mediaId = dto.mediaId ?? null;
    const stickerAssetId = dto.stickerAssetId ?? null;
    if (!content && !mediaId && !stickerAssetId) {
      throw new BadRequestException('评论内容、图片或表情至少需要一项');
    }
    if (mediaId && stickerAssetId) {
      throw new BadRequestException('一条评论只能选择一张图片或一个表情');
    }
    let parentCommentId: string | null = null;
    let replyTarget: { id: string; authorId: string; parentCommentId: string | null } | null = null;
    if (dto.replyToCommentId) {
      replyTarget = await this.prisma.momentComment.findFirst({
        where: { id: dto.replyToCommentId, momentId, deletedAt: null },
        select: { id: true, authorId: true, parentCommentId: true },
      });
      if (!replyTarget) throw new NotFoundException('被回复的评论不存在');
      await this.assertUsersCanInteract(viewer.id, replyTarget.authorId);
      parentCommentId = replyTarget.parentCommentId ?? replyTarget.id;
    }
    const requestHash = hashIdempotencyPayload({
      momentId,
      content,
      mediaId,
      stickerAssetId,
      replyToCommentId: replyTarget?.id ?? null,
    });
    const replay = await this.prisma.momentComment.findUnique({
      where: { authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId } },
      select: { id: true, createRequestHash: true },
    });
    if (replay) {
      if (replay.createRequestHash !== requestHash) throw new ConflictException('同一评论请求不能用于不同内容');
      return this.findMapped(replay.id, viewer, moment.authorId);
    }

    const recipientId = replyTarget?.authorId ?? moment.authorId;
    let createdId: string;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.assertMediaAvailable(tx, viewer.id, mediaId);
        if (stickerAssetId) await this.stickers.assertFavorite(viewer.id, stickerAssetId, tx);
        const comment = await tx.momentComment.create({
          data: {
            momentId,
            authorId: viewer.id,
            parentCommentId,
            replyToCommentId: replyTarget?.id,
            clientRequestId: dto.clientRequestId,
            createRequestHash: requestHash,
            content,
            mediaId,
            stickerAssetId,
          },
          select: { id: true },
        });
        if (stickerAssetId) await this.stickers.recordUsage(viewer.id, stickerAssetId, tx);
        await tx.moment.update({ where: { id: momentId }, data: { commentCount: { increment: 1 } } });
        if (recipientId !== viewer.id) {
          await this.outbox.enqueue(tx, {
            eventType: 'moment.comment.created',
            aggregateType: 'MomentComment',
            aggregateId: comment.id,
            eventKey: `moment-comment-created:${comment.id}`,
            payload: {
              commentId: comment.id,
              momentId,
              momentTitle: moment.title,
              actorId: viewer.id,
              actorUsername: viewer.username ?? '有人',
              recipientId,
              isReply: Boolean(replyTarget),
            },
          });
        }
        return comment;
      });
      createdId = created.id;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const raced = await this.prisma.momentComment.findUnique({
        where: { authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId } },
        select: { id: true, createRequestHash: true },
      });
      if (!raced) throw new ConflictException('图片已用于其他评论');
      if (raced.createRequestHash !== requestHash) throw new ConflictException('同一评论请求不能用于不同内容');
      createdId = raced.id;
    }
    return this.findMapped(createdId, viewer, moment.authorId);
  }

  async remove(momentId: string, commentId: string, viewer: Viewer) {
    const comment = await this.prisma.momentComment.findFirst({
      where: { id: commentId, momentId },
      select: { authorId: true, deletedAt: true, moment: { select: { authorId: true, deletedAt: true } } },
    });
    if (!comment || comment.moment.deletedAt) throw new NotFoundException('评论不存在');
    const admin = viewer.role === 'ADMIN' || viewer.role === 'SUPER_ADMIN';
    if (comment.authorId !== viewer.id && comment.moment.authorId !== viewer.id && !admin) {
      throw new ForbiddenException('无权删除该评论');
    }
    if (comment.deletedAt) return { message: '评论已删除' };
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.momentComment.updateMany({
        where: { id: commentId, deletedAt: null },
        data: {
          deletedAt: new Date(),
          removalSource: admin && comment.authorId !== viewer.id ? 'ADMIN' : comment.moment.authorId === viewer.id && comment.authorId !== viewer.id ? 'OWNER' : 'AUTHOR',
          removedById: viewer.id,
        },
      });
      if (removed.count > 0) {
        await tx.moment.update({ where: { id: momentId }, data: { commentCount: { decrement: 1 } } });
      }
    });
    return { message: '评论已删除' };
  }

  private async findMapped(id: string, viewer: Viewer, momentAuthorId: string) {
    const row = await this.prisma.momentComment.findUnique({ where: { id }, select: commentSelect });
    if (!row) throw new NotFoundException('评论不存在');
    return mapMomentComment(row, viewer, momentAuthorId);
  }

  private async assertCursor(id: string, momentId: string, root: boolean, parentCommentId?: string) {
    const row = await this.prisma.momentComment.findFirst({
      where: { id, momentId, parentCommentId: root ? null : parentCommentId },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('无效的评论分页游标');
  }

  private async excludedAuthorIds(viewerId?: string) {
    if (!viewerId) return [];
    const rows = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    return [...new Set(rows.map((row) => row.blockerId === viewerId ? row.blockedId : row.blockerId))];
  }

  private async assertUsersCanInteract(firstId: string, secondId: string) {
    if (firstId === secondId) return;
    const block = await this.prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: firstId, blockedId: secondId }, { blockerId: secondId, blockedId: firstId }] },
      select: { id: true },
    });
    if (block) throw new ForbiddenException('存在拉黑关系，不能回复');
  }

  private async assertMediaAvailable(
    tx: Prisma.TransactionClient,
    userId: string,
    mediaId: string | null,
  ) {
    if (!mediaId) return;
    const media = await tx.media.findUnique({
      where: { id: mediaId },
      select: {
        userId: true,
        status: true,
        directMessage: { select: { id: true } },
        momentImages: { select: { id: true } },
        momentComment: { select: { id: true } },
      },
    });
    if (!media || media.userId !== userId || media.status !== 'COMPLETED') {
      throw new BadRequestException('图片不存在、尚未处理完成或不属于当前用户');
    }
    if (media.directMessage || media.momentImages.length > 0 || media.momentComment) {
      throw new ConflictException('图片已用于其他内容');
    }
  }
}
