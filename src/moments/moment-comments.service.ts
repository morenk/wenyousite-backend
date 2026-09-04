import { HttpStatus, Injectable } from '@nestjs/common';
import { ContentRemovalSource, MediaPurpose, Prisma } from '@prisma/client';
import { paginate } from '../common/dto/paginated-result';
import { hashIdempotencyPayload } from '../common/idempotency';
import { publicUserSummarySelect } from '../common/user-summary';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMomentCommentDto } from './dto/moment-write.dto';
import { mapMomentComment } from './moment.mapper';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { StickersService } from '../stickers/stickers.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import { MomentAccessService } from './moment-access.service';
import { mediaPurposeAllowed } from '../media/media-policy';

type Viewer = { id: string; username?: string; role?: string };

const MAX_PAGE_SIZE = 50;

function badRequest(message: string) {
  return new BusinessException(ErrorCode.BAD_REQUEST, message, HttpStatus.BAD_REQUEST);
}

function conflict(code: number, message: string) {
  return new BusinessException(code, message, HttpStatus.CONFLICT);
}

function momentNotFound(message: string) {
  return notFound(ErrorCode.MOMENT_NOT_FOUND, message);
}

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
      contentType: true,
      width: true,
      height: true,
      purpose: true,
      animated: true,
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
  removalSource: true,
  createdAt: true,
} satisfies Prisma.MomentCommentSelect;

@Injectable()
export class MomentCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MomentAccessService,
    private readonly outbox: OutboxService,
    private readonly stickers: StickersService,
    private readonly mediaReferences: MediaReferenceService,
  ) {}

  async listRoots(
    momentId: string,
    cursor: string | undefined,
    limit = 20,
    viewer?: Viewer,
    order = ReplyOrder.NEWEST,
    authorId?: string,
  ) {
    const moment = await this.access.assertVisible(momentId, viewer?.id);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    if (cursor) await this.assertCursor(cursor, momentId, true);
    const take = Math.min(limit, MAX_PAGE_SIZE);
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
        NOT: {
          deletedAt: { not: null },
          removalSource: ContentRemovalSource.ADMIN,
        },
        ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
        AND: [
          {
            OR: [
              { deletedAt: null },
              {
                replies: {
                  some: {
                    deletedAt: null,
                    ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
                  },
                },
              },
            ],
          },
          ...(authorId
            ? [
                {
                  OR: [{ authorId, deletedAt: null }, { replies: { some: visibleReplyWhere } }],
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
        // 主评论的阅读方向不应改变同一回复串内部从早到晚的对话语义。
        replies: {
          where: visibleReplyWhere,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
    return paginate(
      page.map((row) => ({
        ...mapMomentComment(row, viewer, moment.authorId),
        replyCount: row._count.replies,
        replies: row.replies.map((reply) => mapMomentComment(reply, viewer, moment.authorId)),
      })),
      {
        cursor: page.at(-1)?.id ?? null,
        hasMore,
      },
    );
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
    const moment = await this.access.assertVisible(momentId, viewer?.id);
    const root = await this.prisma.momentComment.findFirst({
      where: { id: rootCommentId, momentId, parentCommentId: null },
      select: { id: true, deletedAt: true, removalSource: true },
    });
    if (!root || (root.deletedAt && root.removalSource === ContentRemovalSource.ADMIN)) {
      throw momentNotFound('主评论不存在');
    }
    if (cursor) await this.assertCursor(cursor, momentId, false, rootCommentId);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    const take = Math.min(limit, MAX_PAGE_SIZE);
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
    return paginate(
      page.map((row) => mapMomentComment(row, viewer, moment.authorId)),
      {
        cursor: page.at(-1)?.id ?? null,
        hasMore,
      },
    );
  }

  async listAuthors(momentId: string, viewer?: Viewer) {
    await this.access.assertVisible(momentId, viewer?.id);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    const rows = await this.prisma.momentComment.findMany({
      where: {
        momentId,
        deletedAt: null,
        OR: [
          { parentCommentId: null },
          { parentComment: { deletedAt: null } },
          {
            parentComment: {
              deletedAt: { not: null },
              removalSource: { not: ContentRemovalSource.ADMIN },
            },
          },
        ],
        ...(excludedAuthors.length ? { authorId: { notIn: excludedAuthors } } : {}),
      },
      distinct: ['authorId'],
      orderBy: { authorId: 'asc' },
      select: { author: { select: publicUserSummarySelect } },
    });
    return rows
      .map((row) => row.author)
      .sort(
        (first, second) =>
          first.username.localeCompare(second.username, 'zh-CN') ||
          first.id.localeCompare(second.id),
      );
  }

  async findContext(momentId: string, commentId: string, viewer?: Viewer) {
    const moment = await this.access.assertVisible(momentId, viewer?.id);
    const excludedAuthors = await this.excludedAuthorIds(viewer?.id);
    const visibleAuthorWhere = excludedAuthors.length
      ? { authorId: { notIn: excludedAuthors } }
      : {};
    const target = await this.prisma.momentComment.findFirst({
      where: {
        id: commentId,
        momentId,
        deletedAt: null,
        ...visibleAuthorWhere,
      },
      select: commentSelect,
    });
    if (!target) throw momentNotFound('目标评论不存在或不可见');

    const rootCommentId = target.parentCommentId ?? target.id;
    const root = target.parentCommentId
      ? await this.prisma.momentComment.findFirst({
          where: {
            id: rootCommentId,
            momentId,
            parentCommentId: null,
            ...visibleAuthorWhere,
          },
          select: commentSelect,
        })
      : target;
    if (!root || (root.deletedAt && root.removalSource === ContentRemovalSource.ADMIN)) {
      throw momentNotFound('目标评论不存在或不可见');
    }

    const replyCount = await this.prisma.momentComment.count({
      where: {
        parentCommentId: rootCommentId,
        deletedAt: null,
        ...visibleAuthorWhere,
      },
    });
    return {
      root: mapMomentComment(root, viewer, moment.authorId),
      target: mapMomentComment(target, viewer, moment.authorId),
      replyCount,
    };
  }

  async create(momentId: string, dto: CreateMomentCommentDto, viewer: Viewer) {
    const content = dto.content?.trim() ?? '';
    const mediaId = dto.mediaId ?? null;
    const stickerAssetId = dto.stickerAssetId ?? null;
    if (!content && !mediaId && !stickerAssetId) {
      throw badRequest('评论内容、图片或表情至少需要一项');
    }
    if (mediaId && stickerAssetId) {
      throw badRequest('一条评论只能选择一张图片或一个表情');
    }
    const moment = await this.access.assertVisible(momentId, viewer.id);
    const requestHash = hashIdempotencyPayload({
      momentId,
      content,
      mediaId,
      stickerAssetId,
      replyToCommentId: dto.replyToCommentId ?? null,
    });
    const replay = await this.prisma.momentComment.findUnique({
      where: {
        authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId },
      },
      select: { id: true, createRequestHash: true },
    });
    if (replay) {
      if (replay.createRequestHash !== requestHash)
        throw conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, '同一评论请求不能用于不同内容');
      return this.findMapped(replay.id, viewer, moment.authorId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const preliminaryReply = dto.replyToCommentId
          ? await tx.momentComment.findFirst({
              where: { id: dto.replyToCommentId, momentId, deletedAt: null },
              select: { authorId: true },
            })
          : null;
        const lockedMoment = await this.access.lockVisible(
          tx,
          momentId,
          viewer.id,
          preliminaryReply ? [preliminaryReply.authorId] : [],
        );
        this.access.assertCanAddInteraction(lockedMoment);
        const replyTarget = dto.replyToCommentId
          ? await tx.momentComment.findFirst({
              where: { id: dto.replyToCommentId, momentId, deletedAt: null },
              select: {
                id: true,
                authorId: true,
                parentCommentId: true,
                parentComment: { select: { deletedAt: true, removalSource: true } },
              },
            })
          : null;
        if (dto.replyToCommentId && !replyTarget) {
          throw momentNotFound('被回复的评论不存在');
        }
        if (replyTarget) {
          if (
            replyTarget.parentComment?.deletedAt &&
            replyTarget.parentComment.removalSource === ContentRemovalSource.ADMIN
          ) {
            throw momentNotFound('被回复的评论不存在');
          }
          await this.assertUsersCanInteract(tx, viewer.id, replyTarget.authorId);
        }
        const parentCommentId = replyTarget
          ? (replyTarget.parentCommentId ?? replyTarget.id)
          : null;
        const recipientId = replyTarget?.authorId ?? lockedMoment.authorId;
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
          select: { id: true, createdAt: true },
        });
        if (mediaId) await this.mediaReferences.reconcileMediaIds(tx, [mediaId]);
        if (stickerAssetId) await this.stickers.recordUsage(viewer.id, stickerAssetId, tx);
        const updated = await tx.moment.updateMany({
          where: { id: momentId, deletedAt: null },
          data: { commentCount: { increment: 1 } },
        });
        if (updated.count === 0) throw momentNotFound('动态不存在');
        await this.outbox.enqueue(tx, {
          eventType: 'moment.comment.created',
          aggregateType: 'MomentComment',
          aggregateId: comment.id,
          eventKey: `moment-comment-created:${comment.id}`,
          payload: {
            commentId: comment.id,
            momentId,
            momentTitle: lockedMoment.title,
            actorId: viewer.id,
            actorUsername: viewer.username ?? '有人',
            recipientId,
            isReply: Boolean(replyTarget),
            momentAuthorId: lockedMoment.authorId,
            occurredAt: comment.createdAt.toISOString(),
          },
        });
        const row = await tx.momentComment.findUniqueOrThrow({
          where: { id: comment.id },
          select: commentSelect,
        });
        return mapMomentComment(row, viewer, lockedMoment.authorId);
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const raced = await this.prisma.momentComment.findUnique({
        where: {
          authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId },
        },
        select: { id: true, createRequestHash: true },
      });
      if (!raced) throw conflict(ErrorCode.CONFLICT, '图片已用于其他评论');
      if (raced.createRequestHash !== requestHash)
        throw conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, '同一评论请求不能用于不同内容');
      return this.findMapped(raced.id, viewer, moment.authorId);
    }
  }

  async remove(momentId: string, commentId: string, viewer: Viewer) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "moments" WHERE "id" = ${momentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "moment_comments" WHERE "id" = ${commentId} FOR UPDATE`;
      const comment = await tx.momentComment.findFirst({
        where: { id: commentId, momentId },
        select: {
          authorId: true,
          deletedAt: true,
          removalSource: true,
          mediaId: true,
          parentComment: { select: { deletedAt: true, removalSource: true } },
          moment: { select: { authorId: true, deletedAt: true } },
        },
      });
      if (
        !comment ||
        comment.moment.deletedAt ||
        (comment.deletedAt && comment.removalSource === ContentRemovalSource.ADMIN) ||
        (comment.parentComment?.deletedAt &&
          comment.parentComment.removalSource === ContentRemovalSource.ADMIN)
      ) {
        throw momentNotFound('评论不存在');
      }
      const admin = viewer.role === 'ADMIN' || viewer.role === 'SUPER_ADMIN';
      if (comment.authorId !== viewer.id && comment.moment.authorId !== viewer.id && !admin) {
        throw new BusinessException(ErrorCode.FORBIDDEN, '无权删除该评论', HttpStatus.FORBIDDEN);
      }
      if (comment.deletedAt) return;
      const restorableAdminRemoval = admin && comment.authorId !== viewer.id;
      await tx.momentComment.update({
        where: { id: commentId },
        data: {
          deletedAt: new Date(),
          removalSource: restorableAdminRemoval
            ? 'ADMIN'
            : comment.moment.authorId === viewer.id && comment.authorId !== viewer.id
              ? 'OWNER'
              : 'AUTHOR',
          removedById: viewer.id,
          ...(!restorableAdminRemoval ? { mediaId: null } : {}),
        },
      });
      await tx.notification.updateMany({
        where: restorableAdminRemoval
          ? {
              isRead: false,
              OR: [
                { momentCommentId: commentId },
                { momentComment: { parentCommentId: commentId } },
              ],
            }
          : { momentCommentId: commentId, isRead: false },
        data: { isRead: true },
      });
      const updated = await tx.moment.updateMany({
        where: { id: momentId, deletedAt: null },
        data: { commentCount: { decrement: 1 } },
      });
      if (updated.count === 0) throw momentNotFound('动态不存在');
      if (!restorableAdminRemoval && comment.mediaId) {
        await this.mediaReferences.reconcileMediaIds(tx, [comment.mediaId]);
      }
    });
    return { message: '评论已删除' };
  }

  private async findMapped(id: string, viewer: Viewer, momentAuthorId: string) {
    const row = await this.prisma.momentComment.findUnique({
      where: { id },
      select: commentSelect,
    });
    if (!row) throw momentNotFound('评论不存在');
    return mapMomentComment(row, viewer, momentAuthorId);
  }

  private async assertCursor(
    id: string,
    momentId: string,
    root: boolean,
    parentCommentId?: string,
  ) {
    const row = await this.prisma.momentComment.findFirst({
      where: { id, momentId, parentCommentId: root ? null : parentCommentId },
      select: { id: true },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.INVALID_CURSOR,
        '无效的评论分页游标',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async excludedAuthorIds(viewerId?: string) {
    if (!viewerId) return [];
    const rows = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    return [
      ...new Set(rows.map((row) => (row.blockerId === viewerId ? row.blockedId : row.blockerId))),
    ];
  }

  private async assertUsersCanInteract(
    client: PrismaService | Prisma.TransactionClient,
    firstId: string,
    secondId: string,
  ) {
    if (firstId === secondId) return;
    const block = await client.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: firstId, blockedId: secondId },
          { blockerId: secondId, blockedId: firstId },
        ],
      },
      select: { id: true },
    });
    if (block) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '存在拉黑关系，不能回复',
        HttpStatus.FORBIDDEN,
      );
    }
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
        purpose: true,
        directMessage: { select: { id: true } },
        momentImages: { select: { id: true } },
        momentComment: { select: { id: true } },
      },
    });
    if (!media || media.userId !== userId || media.status !== 'COMPLETED') {
      throw badRequest('图片不存在、尚未处理完成或不属于当前用户');
    }
    if (!mediaPurposeAllowed(media.purpose, MediaPurpose.MOMENT_COMMENT)) {
      throw badRequest('图片用途与动态评论不匹配');
    }
    if (media.directMessage || media.momentImages.length > 0 || media.momentComment) {
      throw conflict(ErrorCode.CONFLICT, '图片已用于其他内容');
    }
  }
}
