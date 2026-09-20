import { truncateMarkdownToCompactPlainText } from '../common/markdown-truncate';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditTargetType, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  adminCommentWhere,
  adminMomentWhere,
  adminPostWhere,
  adminPostDetailWhere,
  adminRetainedWhere,
  adminThreadWhere,
} from '../access/admin-content.where';
import { AdminContentQueryDto, AdminContentType } from '../admin/dto/admin-content.dto';
import { AdminContentResponseDto } from '../admin/dto/admin-content-response.dto';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { paginate } from '../common/dto/paginated-result';
import { readMediaDisplay } from '../media/media-display';

const author = { select: { id: true, username: true } } as const;
const baseSelect = { id: true, createdAt: true, updatedAt: true, deletedAt: true } as const;
const mediaSelect = { id: true, url: true, displayAsset: true } as const;
const mediaWhere = { status: 'COMPLETED' as const, deletionClaimedAt: null };
type Client = PrismaService | Prisma.TransactionClient;
type Cursor = { createdAt: string; id: string; filter: string };
type Base = { id: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null };

function fingerprint(query: AdminContentQueryDto) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        query.type ?? 'thread',
        query.q?.trim() ?? '',
        query.id ?? '',
        query.authorId ?? '',
        query.status ?? '',
        query.createdAfter ?? '',
        query.createdBefore ?? '',
        query.category ?? '',
        query.tagId ?? '',
      ]),
    )
    .digest('hex');
}
function cursorWhere(query: AdminContentQueryDto) {
  if (!query.cursor) return {};
  try {
    const value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Cursor;
    if (
      typeof value.id !== 'string' ||
      !value.id ||
      value.filter !== fingerprint(query) ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt))
    )
      throw new Error();
    const createdAt = new Date(value.createdAt);
    return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: value.id } }] };
  } catch {
    throw new BusinessException(ErrorCode.INVALID_CURSOR, '分页游标无效，请重新查询');
  }
}
function commonWhere(query: AdminContentQueryDto) {
  if (
    query.createdAfter &&
    query.createdBefore &&
    new Date(query.createdAfter) > new Date(query.createdBefore)
  ) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '开始时间不能晚于结束时间');
  }
  return {
    ...(query.id ? { id: query.id } : {}),
    ...(query.status === 'ACTIVE' ? { deletedAt: null } : {}),
    ...(query.status === 'HIDDEN'
      ? { deletedAt: { not: null }, removalSource: 'ADMIN' as const }
      : {}),
    ...(query.createdAfter || query.createdBefore
      ? {
          createdAt: {
            ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}),
            ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {}),
          },
        }
      : {}),
  };
}
function item(
  type: AdminContentType,
  row: Base,
  user: { id: string; username: string },
  title: string | null,
  content: string,
  extra: Partial<AdminContentResponseDto> = {},
): AdminContentResponseDto {
  const summary = title || truncateMarkdownToCompactPlainText(content, 160, 100);
  const hidden = Boolean(row.deletedAt);
  const parentHidden = extra.parentHidden ?? false;
  return {
    id: row.id,
    type,
    title,
    summary: Array.from(summary).slice(0, 160).join(''),
    author: user,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hidden,
    parentHidden,
    canRestore: hidden && !parentHidden,
    restoreBlockedReason: parentHidden ? '请先恢复父级内容' : null,
    threadId: null,
    parentPostId: null,
    momentId: null,
    parentCommentId: null,
    category: null,
    tags: [],
    version: null,
    ...extra,
  };
}

/** 内容列表、详情和用户计数共享同一后台可见性策略。 */
@Injectable()
export class AdminContentQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminContentQueryDto) {
    const take = query.limit ?? 20;
    const rows = await this.find(this.prisma, query, take + 1);
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const last = page.at(-1);
    return paginate(page, {
      hasMore,
      cursor: last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
              filter: fingerprint(query),
            }),
          ).toString('base64url')
        : null,
    });
  }

  async detail(type: AdminContentType, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = (await this.find(tx, { type, id }, 1, true))[0];
        if (!row) throw notFound(ErrorCode.NOT_FOUND, '内容不存在');
        const detail = await this.body(tx, type, id);
        const auditLogs = await tx.auditLog.findMany({
          where: { targetType: type.toUpperCase() as AuditTargetType, targetId: id },
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            reportId: true,
            reason: true,
            metadata: true,
            createdAt: true,
            actor: { select: { id: true, username: true, role: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
        });
        return { ...row, ...detail, auditLogs };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async counts(authorId: string) {
    const [thread, post, moment, moment_comment] = await Promise.all([
      this.prisma.thread.count({ where: { AND: [adminThreadWhere, { ownerId: authorId }] } }),
      this.prisma.post.count({ where: { AND: [adminPostWhere, { authorId }] } }),
      this.prisma.moment.count({ where: { AND: [adminMomentWhere, { authorId }] } }),
      this.prisma.momentComment.count({ where: { AND: [adminCommentWhere, { authorId }] } }),
    ]);
    return { thread, post, moment, moment_comment };
  }

  private async find(client: Client, query: AdminContentQueryDto, take: number, allowBody = false) {
    const type = query.type ?? 'thread';
    if (type !== 'thread' && (query.category || query.tagId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '分类和标签仅适用于主题帖',
        HttpStatus.BAD_REQUEST,
      );
    }
    const base = commonWhere(query);
    const cursor = cursorWhere(query);
    const q = query.q?.trim();
    const text = q ? { contains: q, mode: 'insensitive' as const } : undefined;
    const paging = { take, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] };
    if (type === 'thread') {
      const rows = await client.thread.findMany({
        where: {
          AND: [
            adminThreadWhere,
            base,
            cursor,
            {
              ...(query.authorId ? { ownerId: query.authorId } : {}),
              ...(query.category ? { category: query.category } : {}),
              ...(query.tagId ? { topicTags: { some: { tagId: query.tagId } } } : {}),
              ...(q ? { OR: [{ id: q }, { title: text }] } : {}),
            },
          ],
        },
        select: {
          ...baseSelect,
          title: true,
          version: true,
          category: true,
          owner: author,
          topicTags: { select: { tag: { select: { id: true, name: true, isActive: true } } } },
        },
        ...paging,
      });
      return rows.map((row) =>
        item(type, row, row.owner, row.title, '', {
          threadId: row.id,
          category: row.category,
          version: row.version,
          tags: row.topicTags.map((tag) => tag.tag),
        }),
      );
    }
    if (type === 'post') {
      const rows = await client.post.findMany({
        where: {
          AND: [
            allowBody ? adminPostDetailWhere : adminPostWhere,
            base,
            cursor,
            {
              ...(query.authorId ? { authorId: query.authorId } : {}),
              ...(q ? { OR: [{ id: q }, { content: text }] } : {}),
            },
          ],
        },
        select: {
          ...baseSelect,
          content: true,
          version: true,
          author,
          threadId: true,
          parentPostId: true,
          thread: { select: { deletedAt: true } },
          parentPost: { select: { deletedAt: true } },
        },
        ...paging,
      });
      return rows.map((row) =>
        item(type, row, row.author, null, row.content, {
          threadId: row.threadId,
          parentPostId: row.parentPostId,
          version: row.version,
          parentHidden: Boolean(row.thread.deletedAt || row.parentPost?.deletedAt),
        }),
      );
    }
    if (type === 'moment') {
      const rows = await client.moment.findMany({
        where: {
          AND: [
            adminMomentWhere,
            base,
            cursor,
            {
              ...(query.authorId ? { authorId: query.authorId } : {}),
              ...(q ? { OR: [{ id: q }, { title: text }, { content: text }] } : {}),
            },
          ],
        },
        select: { ...baseSelect, content: true, title: true, version: true, author },
        ...paging,
      });
      return rows.map((row) =>
        item(type, row, row.author, row.title, row.content, {
          momentId: row.id,
          version: row.version,
        }),
      );
    }
    const rows = await client.momentComment.findMany({
      where: {
        AND: [
          adminCommentWhere,
          base,
          cursor,
          {
            ...(query.authorId ? { authorId: query.authorId } : {}),
            ...(q ? { OR: [{ id: q }, { content: text }] } : {}),
          },
        ],
      },
      select: {
        ...baseSelect,
        content: true,
        author,
        momentId: true,
        parentCommentId: true,
        moment: { select: { deletedAt: true } },
        parentComment: { select: { deletedAt: true } },
      },
      ...paging,
    });
    return rows.map((row) =>
      item(type, row, row.author, null, row.content, {
        momentId: row.momentId,
        parentCommentId: row.parentCommentId,
        parentHidden: Boolean(row.moment.deletedAt || row.parentComment?.deletedAt),
      }),
    );
  }

  private async body(tx: Prisma.TransactionClient, type: AdminContentType, id: string) {
    let content = '';
    let sticker: { id: string; url: string; displayAsset: Prisma.JsonValue | null } | null = null;
    let media: Array<{ id: string; url: string; displayAsset: Prisma.JsonValue | null }> = [];
    if (type === 'thread' || type === 'post') {
      const post = await tx.post.findFirst({
        where:
          type === 'post'
            ? { id, AND: [adminPostDetailWhere] }
            : {
                threadId: id,
                kind: 'BODY',
                AND: [adminRetainedWhere],
                subthread: { deletedAt: null, defaultForThread: { id } },
                thread: adminThreadWhere,
              },
        select: {
          content: true,
          mediaAttachments: {
            where: { media: mediaWhere },
            select: { media: { select: mediaSelect } },
          },
        },
      });
      content = post?.content ?? '';
      media = post?.mediaAttachments.map((attachment) => attachment.media) ?? [];
    } else if (type === 'moment') {
      const moment = await tx.moment.findFirst({
        where: { id, AND: [adminMomentWhere] },
        select: {
          content: true,
          images: {
            where: { media: mediaWhere },
            orderBy: { sortOrder: 'asc' },
            select: { media: { select: mediaSelect } },
          },
        },
      });
      content = moment?.content ?? '';
      media = moment?.images.map((image) => image.media) ?? [];
    } else {
      const comment = await tx.momentComment.findFirst({
        where: { id, AND: [adminCommentWhere] },
        select: {
          content: true,
          media: { where: mediaWhere, select: mediaSelect },
          sticker: { select: mediaSelect },
        },
      });
      content = comment?.content ?? '';
      media = comment?.media ? [comment.media] : [];
      sticker = comment?.sticker ?? null;
    }
    return {
      content,
      mediaIds: media.map((asset) => asset.id),
      media: [...media, ...(sticker ? [sticker] : [])].map(
        ({ id: mediaId, url, displayAsset }) => ({
          id: mediaId,
          url,
          display: readMediaDisplay(displayAsset),
        }),
      ),
    };
  }
}
