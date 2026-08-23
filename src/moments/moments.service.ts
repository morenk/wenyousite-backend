import { HttpStatus, Injectable } from '@nestjs/common';
import { MediaPurpose, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { paginate } from '../common/dto/paginated-result';
import { hashIdempotencyPayload } from '../common/idempotency';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateMomentDto, UpdateMomentDto } from './dto/moment-write.dto';
import { MomentFeedMode } from './dto/moment-query.dto';
import { mapMomentCard, mapMomentDetail, type MomentCardRow, type MomentDetailRow } from './moment.mapper';
import {
  momentCardSelect,
  momentDetailSelect,
  momentViewerVisibility,
  visibleMomentAuthorWhere,
} from './moment-query';
import { MediaReferenceService } from '../media/media-reference.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { isUniqueConstraintViolation } from '../common/prisma-errors';
import { MomentAccessService } from './moment-access.service';
import { mediaPurposeAllowed } from '../media/media-policy';

const MAX_PAGE_SIZE = 50;
const DISCOVER_SNAPSHOT_LIMIT = 1000;
const DISCOVER_SNAPSHOT_TTL_SECONDS = 15 * 60;
const DISCOVER_SNAPSHOT_KEY_PREFIX = 'moments:discover:snapshot:';
const TEXT_COVER_THEMES = ['ROSE', 'LILAC', 'MINT', 'AMBER'] as const;

type Viewer = { id: string; role?: string };

interface DiscoverRow {
  id: string;
}

interface DiscoverCursor {
  snapshotId: string;
  offset: number;
}

interface DateCursor {
  createdAt: string;
  id: string;
}

interface SearchCursor extends DateCursor {
  relevance: number;
}

function encodeCursor(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function badRequest(message: string) {
  return new BusinessException(ErrorCode.BAD_REQUEST, message, HttpStatus.BAD_REQUEST);
}

function invalidCursor(message: string) {
  return new BusinessException(ErrorCode.INVALID_CURSOR, message, HttpStatus.BAD_REQUEST);
}

function conflict(code: number, message: string) {
  return new BusinessException(code, message, HttpStatus.CONFLICT);
}

function momentNotFound(message = '动态不存在') {
  return notFound(ErrorCode.MOMENT_NOT_FOUND, message);
}

function decodeDateCursor(cursor: string): DateCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<DateCursor>;
    if (!value.id || !value.createdAt || Number.isNaN(Date.parse(value.createdAt)))
      throw new Error();
    return value as DateCursor;
  } catch {
    throw invalidCursor('无效的动态分页游标');
  }
}

function decodeDiscoverCursor(cursor: string): DiscoverCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<DiscoverCursor>;
    if (
      !value.snapshotId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.snapshotId,
      ) ||
      !Number.isInteger(value.offset) ||
      value.offset! < 1 ||
      value.offset! >= DISCOVER_SNAPSHOT_LIMIT
    )
      throw new Error();
    return value as DiscoverCursor;
  } catch {
    throw invalidCursor('无效的动态分页游标');
  }
}

function decodeSearchCursor(cursor: string): SearchCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<SearchCursor>;
    if (
      !value.id ||
      typeof value.relevance !== 'number' ||
      !Number.isFinite(value.relevance) ||
      !value.createdAt ||
      Number.isNaN(Date.parse(value.createdAt))
    )
      throw new Error();
    return value as SearchCursor;
  } catch {
    throw invalidCursor('无效的动态搜索游标');
  }
}

function escapeLikePattern(keyword: string) {
  return keyword.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class MomentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mediaReferences: MediaReferenceService,
    private readonly access: MomentAccessService,
  ) {}

  async list(feed: MomentFeedMode, cursor: string | undefined, limit = 20, viewer?: Viewer) {
    if (feed === MomentFeedMode.FOLLOWING) {
      if (!viewer) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '登录后才能查看关注动态',
          HttpStatus.FORBIDDEN,
        );
      }
      return this.listFollowing(cursor, limit, viewer);
    }
    return this.listDiscover(cursor, limit, viewer);
  }

  async findById(id: string, viewer?: Viewer) {
    const moment = await this.prisma.moment.findFirst({
      where: { id, deletedAt: null, ...momentViewerVisibility(viewer?.id) },
      select: momentDetailSelect(viewer?.id),
    });
    if (!moment) throw momentNotFound();
    return mapMomentDetail(moment as unknown as MomentDetailRow, viewer);
  }

  async create(dto: CreateMomentDto, viewer: Viewer) {
    const title = dto.title.trim();
    const content = dto.content?.trim() ?? '';
    const mediaIds = dto.mediaIds ?? [];
    const coverMediaId = this.resolveCover(mediaIds, dto.coverMediaId);
    const requestHash = hashIdempotencyPayload({ title, content, mediaIds, coverMediaId });
    const replay = await this.prisma.moment.findUnique({
      where: {
        authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId },
      },
      select: { id: true, createRequestHash: true },
    });
    if (replay) {
      if (replay.createRequestHash !== requestHash) {
        throw conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, '同一发布请求不能用于不同动态内容');
      }
      return this.findById(replay.id, viewer);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.access.lockActiveUser(tx, viewer.id);
        await this.assertMediaUsable(tx, mediaIds, viewer.id);
        const moment = await tx.moment.create({
          data: {
            authorId: viewer.id,
            title,
            content,
            clientRequestId: dto.clientRequestId,
            createRequestHash: requestHash,
            textCoverTheme: this.themeFor(dto.clientRequestId),
            coverMediaId,
            images: {
              create: mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
            },
          },
          select: { id: true },
        });
        await this.mediaReferences.reconcileMediaIds(tx, mediaIds);
        const detail = await tx.moment.findUniqueOrThrow({
          where: { id: moment.id },
          select: momentDetailSelect(viewer.id),
        });
        return mapMomentDetail(detail as unknown as MomentDetailRow, viewer);
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const raced = await this.prisma.moment.findUnique({
        where: {
          authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId },
        },
        select: { id: true, createRequestHash: true },
      });
      if (!raced) throw conflict(ErrorCode.CONFLICT, '图片已被其他动态使用');
      if (raced.createRequestHash !== requestHash)
        throw conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, '同一发布请求不能用于不同动态内容');
      return this.findById(raced.id, viewer);
    }
  }

  async update(id: string, dto: UpdateMomentDto, viewer: Viewer) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const visible = await this.access.lockVisible(tx, id, viewer.id);
        if (visible.authorId !== viewer.id) {
          throw new BusinessException(
            ErrorCode.FORBIDDEN,
            '只能编辑自己的动态',
            HttpStatus.FORBIDDEN,
          );
        }
        const existing = await tx.moment.findUniqueOrThrow({
          where: { id },
          select: {
            version: true,
            coverMediaId: true,
            images: { orderBy: { sortOrder: 'asc' }, select: { mediaId: true } },
          },
        });
        if (existing.version !== dto.version) {
          throw conflict(
            ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
            '动态已在其他位置更新，请刷新后重试',
          );
        }
        const mediaIds = dto.mediaIds ?? existing.images.map((image) => image.mediaId);
        const requestedCover = Object.prototype.hasOwnProperty.call(dto, 'coverMediaId')
          ? dto.coverMediaId
          : existing.coverMediaId;
        const coverMediaId = this.resolveCover(mediaIds, requestedCover);
        await this.assertMediaUsable(tx, mediaIds, viewer.id, id);
        await tx.moment.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
            ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
            coverMediaId,
            version: { increment: 1 },
          },
        });
        if (dto.mediaIds !== undefined) {
          await tx.momentImage.deleteMany({ where: { momentId: id } });
          await tx.momentImage.createMany({
            data: mediaIds.map((mediaId, sortOrder) => ({ momentId: id, mediaId, sortOrder })),
          });
        }
        await this.mediaReferences.reconcileMediaIds(tx, [
          ...existing.images.map((image) => image.mediaId),
          ...(existing.coverMediaId ? [existing.coverMediaId] : []),
          ...mediaIds,
          ...(coverMediaId ? [coverMediaId] : []),
        ]);
        const detail = await tx.moment.findUniqueOrThrow({
          where: { id },
          select: momentDetailSelect(viewer.id),
        });
        return mapMomentDetail(detail as unknown as MomentDetailRow, viewer);
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      throw conflict(ErrorCode.CONFLICT, '图片已被其他动态使用');
    }
  }

  async remove(id: string, viewer: Viewer) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "moments" WHERE "id" = ${id} FOR UPDATE`;
      const moment = await tx.moment.findUnique({
        where: { id },
        select: {
          authorId: true,
          deletedAt: true,
          coverMediaId: true,
          images: { select: { mediaId: true } },
        },
      });
      if (!moment || moment.deletedAt) throw momentNotFound();
      const admin = viewer.role === 'ADMIN' || viewer.role === 'SUPER_ADMIN';
      if (moment.authorId !== viewer.id && !admin) {
        throw new BusinessException(ErrorCode.FORBIDDEN, '无权删除该动态', HttpStatus.FORBIDDEN);
      }
      const restorableAdminRemoval = admin && moment.authorId !== viewer.id;
      await tx.moment.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          removalSource: restorableAdminRemoval ? 'ADMIN' : 'AUTHOR',
          removedById: viewer.id,
          ...(!restorableAdminRemoval ? { coverMediaId: null } : {}),
        },
      });
      if (!restorableAdminRemoval) {
        await tx.momentImage.deleteMany({ where: { momentId: id } });
        await this.mediaReferences.reconcileMediaIds(tx, [
          ...moment.images.map((image) => image.mediaId),
          ...(moment.coverMediaId ? [moment.coverMediaId] : []),
        ]);
      }
    });
    return { message: '动态已删除' };
  }

  async setLike(id: string, viewer: Viewer, active: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const moment = await this.access.lockVisible(tx, id, viewer.id);
      if (active) {
        const existing = await tx.momentLike.findUnique({
          where: { momentId_userId: { momentId: id, userId: viewer.id } },
          select: { id: true },
        });
        if (!existing) this.access.assertCanAddInteraction(moment);
        const created = await tx.momentLike.createMany({
          data: [{ momentId: id, userId: viewer.id }],
          skipDuplicates: true,
        });
        if (created.count > 0) {
          const updated = await tx.moment.updateMany({
            where: { id, deletedAt: null },
            data: { likeCount: { increment: 1 } },
          });
          if (updated.count === 0) throw momentNotFound();
        }
      } else {
        const removed = await tx.momentLike.deleteMany({
          where: { momentId: id, userId: viewer.id },
        });
        if (removed.count > 0) {
          const updated = await tx.moment.updateMany({
            where: { id, deletedAt: null },
            data: { likeCount: { decrement: 1 } },
          });
          if (updated.count === 0) throw momentNotFound();
        }
      }
      const current = await tx.moment.findUniqueOrThrow({
        where: { id },
        select: { likeCount: true },
      });
      return { momentId: id, count: current.likeCount, active };
    });
  }

  async listUserMoments(userId: string, cursor: string | undefined, limit = 20, viewer?: Viewer) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    const take = Math.min(limit, MAX_PAGE_SIZE);
    const decoded = cursor ? decodeDateCursor(cursor) : undefined;
    const rows = await this.prisma.moment.findMany({
      where: {
        authorId: userId,
        deletedAt: null,
        ...momentViewerVisibility(viewer?.id),
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: new Date(decoded.createdAt) } },
                { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: momentCardSelect(viewer?.id),
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take) as MomentCardRow[];
    const last = page.at(-1);
    return paginate(page.map(mapMomentCard), {
      cursor: last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    });
  }

  async search(q: string, cursor: string | undefined, limit = 20, viewer?: Viewer) {
    const keyword = q.trim();
    if (Array.from(keyword).length < 2) throw badRequest('动态搜索至少需要 2 个字符');
    const take = Math.min(limit, 20);
    const decoded = cursor ? decodeSearchCursor(cursor) : undefined;
    const likePattern = `%${escapeLikePattern(keyword)}%`;
    const blockClause = viewer
      ? Prisma.sql`AND NOT EXISTS (
          SELECT 1 FROM "user_blocks" b
          WHERE (b."blocker_id" = ${viewer.id} AND b."blocked_id" = m."author_id")
             OR (b."blocker_id" = m."author_id" AND b."blocked_id" = ${viewer.id})
        )`
      : Prisma.empty;
    const cursorClause = decoded
      ? Prisma.sql`AND (
          ranked.relevance < ${decoded.relevance}
          OR (ranked.relevance = ${decoded.relevance} AND ranked."createdAt" < ${new Date(decoded.createdAt)})
          OR (ranked.relevance = ${decoded.relevance} AND ranked."createdAt" = ${new Date(decoded.createdAt)} AND ranked.id < ${decoded.id})
        )`
      : Prisma.empty;
    const ranked = await this.prisma.$queryRaw<
      Array<{ id: string; relevance: number; createdAt: Date }>
    >(Prisma.sql`
      WITH ranked AS (
        SELECT m.id,
          (similarity(m.title, ${keyword}) * 2 + similarity(m.content, ${keyword}))::double precision AS relevance,
          m."created_at" AS "createdAt"
        FROM "moments" m
        WHERE m."deleted_at" IS NULL
          AND (m.title ILIKE ${likePattern} ESCAPE '\\' OR m.content ILIKE ${likePattern} ESCAPE '\\')
          ${blockClause}
      )
      SELECT id, relevance, "createdAt" FROM ranked
      WHERE true ${cursorClause}
      ORDER BY relevance DESC, "createdAt" DESC, id DESC
      LIMIT ${take + 1}
    `);
    const hasMore = ranked.length > take;
    const page = ranked.slice(0, take);
    const cards = await this.loadCards(
      page.map((row) => row.id),
      viewer?.id,
    );
    const relevanceById = new Map(page.map((row) => [row.id, row.relevance]));
    const last = page.at(-1);
    return paginate(
      cards.map((card) => ({ ...card, relevance: relevanceById.get(card.id) })),
      {
        cursor: last
          ? encodeCursor({
              relevance: last.relevance,
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
        hasMore,
      },
    );
  }

  async assertVisible(id: string, viewerId?: string) {
    return this.access.assertVisible(id, viewerId);
  }

  private async listDiscover(cursor: string | undefined, limit: number, viewer?: Viewer) {
    const take = Math.min(limit, MAX_PAGE_SIZE);
    if (cursor) return this.listDiscoverSnapshot(cursor, take, viewer);

    const asOf = new Date();
    const scoreExpression = Prisma.sql`(
      1 + m."like_count" * 2 + m."comment_count" * 4 + m."bookmark_count" * 3
        + LN(1 + m."tip_total"::numeric) * 5
      ) / POWER(GREATEST(EXTRACT(EPOCH FROM (${asOf} - m."created_at")) / 3600, 0) + 2, 1.25)`;
    const blockClause = viewer
      ? Prisma.sql`AND NOT EXISTS (
          SELECT 1 FROM "user_blocks" b
          WHERE (b."blocker_id" = ${viewer.id} AND b."blocked_id" = m."author_id")
             OR (b."blocker_id" = m."author_id" AND b."blocked_id" = ${viewer.id})
        )`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<DiscoverRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT m.id, (${scoreExpression})::double precision AS score, m."created_at" AS "createdAt"
        FROM "moments" m
        INNER JOIN "users" u ON u.id = m."author_id" AND u."deleted_at" IS NULL
        WHERE m."deleted_at" IS NULL AND m."created_at" <= ${asOf} ${blockClause}
      )
      SELECT id FROM ranked
      ORDER BY score DESC, "createdAt" DESC, id DESC
      LIMIT ${DISCOVER_SNAPSHOT_LIMIT + 1}
    `);
    const snapshotRows = rows.slice(0, DISCOVER_SNAPSHOT_LIMIT);
    const page = snapshotRows.slice(0, take);
    const hasMore = snapshotRows.length > take;
    const cards = await this.loadCards(page.map((row) => row.id), viewer?.id, true);
    const snapshotId = hasMore ? randomUUID() : null;
    if (snapshotId) {
      const key = this.discoverSnapshotKey(snapshotId);
      try {
        await this.redis.zaddMultiWithExpiry(
          key,
          DISCOVER_SNAPSHOT_TTL_SECONDS,
          ...snapshotRows.flatMap((row, index) => [index, row.id]),
        );
      } catch {
        throw new BusinessException(
          ErrorCode.INTERNAL_ERROR,
          '动态发现流暂时不可用，请稍后重试',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    return paginate(cards, {
      cursor: snapshotId ? encodeCursor({ snapshotId, offset: page.length }) : null,
      hasMore,
    });
  }

  private async listDiscoverSnapshot(cursor: string, take: number, viewer?: Viewer) {
    const decoded = decodeDiscoverCursor(cursor);
    const key = this.discoverSnapshotKey(decoded.snapshotId);
    let ids: string[];
    try {
      ids = await this.redis.zrange(key, decoded.offset, decoded.offset + take);
    } catch {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '动态发现流暂时不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (ids.length === 0) {
      throw invalidCursor('动态发现流快照已过期，请刷新后重试');
    }
    try {
      await this.redis.expire(key, DISCOVER_SNAPSHOT_TTL_SECONDS);
    } catch {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '动态发现流暂时不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const hasMore = ids.length > take;
    const pageIds = ids.slice(0, take);
    const cards = await this.loadCards(pageIds, viewer?.id, true);
    const nextOffset = decoded.offset + pageIds.length;
    return paginate(cards, {
      cursor: hasMore ? encodeCursor({ snapshotId: decoded.snapshotId, offset: nextOffset }) : null,
      hasMore,
    });
  }

  private discoverSnapshotKey(snapshotId: string) {
    return `${DISCOVER_SNAPSHOT_KEY_PREFIX}${snapshotId}`;
  }

  private async listFollowing(cursor: string | undefined, limit: number, viewer: Viewer) {
    const take = Math.min(limit, MAX_PAGE_SIZE);
    const decoded = cursor ? decodeDateCursor(cursor) : undefined;
    const rows = await this.prisma.moment.findMany({
      where: {
        deletedAt: null,
        author: {
          deletedAt: null,
          followers: { some: { followerId: viewer.id } },
          ...visibleMomentAuthorWhere(viewer.id),
        },
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: new Date(decoded.createdAt) } },
                { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: momentCardSelect(viewer.id),
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take) as MomentCardRow[];
    const last = page.at(-1);
    return paginate(page.map(mapMomentCard), {
      cursor: last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    });
  }

  private async loadCards(ids: string[], viewerId?: string, requireActiveAuthor = false) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.moment.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...(requireActiveAuthor
          ? {
              author: {
                deletedAt: null,
                ...(viewerId ? visibleMomentAuthorWhere(viewerId) : {}),
              },
            }
          : momentViewerVisibility(viewerId)),
      },
      select: momentCardSelect(viewerId),
    });
    const byId = new Map(rows.map((row) => [row.id, mapMomentCard(row as MomentCardRow)]));
    return ids.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
  }

  private resolveCover(mediaIds: string[], requested?: string | null) {
    if (mediaIds.length === 0) {
      if (requested) throw badRequest('无图片动态不能指定图片封面');
      return null;
    }
    const cover = requested || mediaIds[0];
    if (!mediaIds.includes(cover)) throw badRequest('封面必须来自动态图片');
    return cover;
  }

  private async assertMediaUsable(
    client: PrismaService | Prisma.TransactionClient,
    mediaIds: string[],
    userId: string,
    currentMomentId?: string,
  ) {
    if (mediaIds.length === 0) return;
    const media = await client.media.findMany({
      where: { id: { in: mediaIds }, userId, status: 'COMPLETED' },
      select: { id: true, purpose: true, momentImages: { select: { momentId: true } } },
    });
    if (media.length !== mediaIds.length)
      throw badRequest('图片不存在、未处理完成或不属于当前用户');
    if (media.some((item) => !mediaPurposeAllowed(item.purpose, MediaPurpose.MOMENT))) {
      throw badRequest('图片用途与动态不匹配');
    }
    const occupied = media.some((item) =>
      item.momentImages.some((image) => image.momentId !== currentMomentId),
    );
    if (occupied) throw conflict(ErrorCode.CONFLICT, '图片已用于其他动态');
  }

  private themeFor(clientRequestId: string) {
    const nibble = Number.parseInt(clientRequestId.replace(/-/g, '').at(-1) ?? '0', 16);
    return TEXT_COVER_THEMES[Number.isFinite(nibble) ? nibble % TEXT_COVER_THEMES.length : 0];
  }
}
