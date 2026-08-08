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
import { PrismaService } from '../prisma/prisma.service';
import { CreateMomentDto, UpdateMomentDto } from './dto/moment-write.dto';
import { MomentFeedMode } from './dto/moment-query.dto';
import {
  mapMomentCard,
  mapMomentDetail,
  momentAuthorSelect,
  momentMediaSelect,
  type MomentCardRow,
  type MomentDetailRow,
} from './moment.mapper';

const MAX_PAGE_SIZE = 30;
const TEXT_COVER_THEMES = ['ROSE', 'LILAC', 'MINT', 'AMBER'] as const;

type Viewer = { id: string; role?: string };

interface DiscoverRow {
  id: string;
  score: number;
  createdAt: Date;
}

interface DiscoverCursor {
  score: number;
  createdAt: string;
  id: string;
  asOf: string;
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

function decodeDateCursor(cursor: string): DateCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<DateCursor>;
    if (!value.id || !value.createdAt || Number.isNaN(Date.parse(value.createdAt))) throw new Error();
    return value as DateCursor;
  } catch {
    throw new BadRequestException('无效的动态分页游标');
  }
}

function decodeDiscoverCursor(cursor: string): DiscoverCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<DiscoverCursor>;
    if (
      !value.id ||
      typeof value.score !== 'number' ||
      !Number.isFinite(value.score) ||
      !value.createdAt ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      !value.asOf ||
      Number.isNaN(Date.parse(value.asOf))
    ) throw new Error();
    return value as DiscoverCursor;
  } catch {
    throw new BadRequestException('无效的动态分页游标');
  }
}

function decodeSearchCursor(cursor: string): SearchCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<SearchCursor>;
    if (
      !value.id ||
      typeof value.relevance !== 'number' ||
      !Number.isFinite(value.relevance) ||
      !value.createdAt ||
      Number.isNaN(Date.parse(value.createdAt))
    ) throw new Error();
    return value as SearchCursor;
  } catch {
    throw new BadRequestException('无效的动态搜索游标');
  }
}

function escapeLikePattern(keyword: string) {
  return keyword.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class MomentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(feed: MomentFeedMode, cursor: string | undefined, limit = 20, viewer?: Viewer) {
    if (feed === MomentFeedMode.FOLLOWING) {
      if (!viewer) throw new ForbiddenException('登录后才能查看关注动态');
      return this.listFollowing(cursor, limit, viewer);
    }
    return this.listDiscover(cursor, limit, viewer);
  }

  async findById(id: string, viewer?: Viewer) {
    const moment = await this.prisma.moment.findFirst({
      where: { id, deletedAt: null, ...this.viewerVisibility(viewer?.id) },
      select: this.detailSelect(viewer?.id),
    });
    if (!moment) throw new NotFoundException('动态不存在');
    return mapMomentDetail(moment as unknown as MomentDetailRow, viewer);
  }

  async create(dto: CreateMomentDto, viewer: Viewer) {
    const title = dto.title.trim();
    const content = dto.content?.trim() ?? '';
    const mediaIds = dto.mediaIds ?? [];
    const coverMediaId = this.resolveCover(mediaIds, dto.coverMediaId);
    const requestHash = hashIdempotencyPayload({ title, content, mediaIds, coverMediaId });
    const replay = await this.prisma.moment.findUnique({
      where: { authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId } },
      select: { id: true, createRequestHash: true },
    });
    if (replay) {
      if (replay.createRequestHash !== requestHash) {
        throw new ConflictException('同一发布请求不能用于不同动态内容');
      }
      return this.findById(replay.id, viewer);
    }
    await this.assertMediaUsable(mediaIds, viewer.id);

    let createdId: string;
    try {
      const created = await this.prisma.$transaction((tx) =>
        tx.moment.create({
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
        }),
      );
      createdId = created.id;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const raced = await this.prisma.moment.findUnique({
        where: { authorId_clientRequestId: { authorId: viewer.id, clientRequestId: dto.clientRequestId } },
        select: { id: true, createRequestHash: true },
      });
      if (!raced) throw new ConflictException('图片已被其他动态使用');
      if (raced.createRequestHash !== requestHash) throw new ConflictException('同一发布请求不能用于不同动态内容');
      createdId = raced.id;
    }
    return this.findById(createdId, viewer);
  }

  async update(id: string, dto: UpdateMomentDto, viewer: Viewer) {
    const existing = await this.prisma.moment.findUnique({
      where: { id, deletedAt: null },
      select: {
        authorId: true,
        coverMediaId: true,
        images: { orderBy: { sortOrder: 'asc' }, select: { mediaId: true } },
      },
    });
    if (!existing) throw new NotFoundException('动态不存在');
    if (existing.authorId !== viewer.id) throw new ForbiddenException('只能编辑自己的动态');

    const mediaIds = dto.mediaIds ?? existing.images.map((image) => image.mediaId);
    const requestedCover = Object.prototype.hasOwnProperty.call(dto, 'coverMediaId')
      ? dto.coverMediaId
      : existing.coverMediaId;
    const coverMediaId = this.resolveCover(mediaIds, requestedCover);
    await this.assertMediaUsable(mediaIds, viewer.id, id);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.moment.updateMany({
        where: { id, authorId: viewer.id, deletedAt: null, version: dto.version },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
          coverMediaId,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) return false;
      if (dto.mediaIds !== undefined) {
        await tx.momentImage.deleteMany({ where: { momentId: id } });
        await tx.momentImage.createMany({
          data: mediaIds.map((mediaId, sortOrder) => ({ momentId: id, mediaId, sortOrder })),
        });
      }
      return true;
    });
    if (!result) throw new ConflictException('动态已在其他位置更新，请刷新后重试');
    return this.findById(id, viewer);
  }

  async remove(id: string, viewer: Viewer) {
    const moment = await this.prisma.moment.findUnique({ where: { id }, select: { authorId: true, deletedAt: true } });
    if (!moment || moment.deletedAt) throw new NotFoundException('动态不存在');
    const admin = viewer.role === 'ADMIN' || viewer.role === 'SUPER_ADMIN';
    if (moment.authorId !== viewer.id && !admin) throw new ForbiddenException('无权删除该动态');
    await this.prisma.moment.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        removalSource: admin && moment.authorId !== viewer.id ? 'ADMIN' : 'AUTHOR',
        removedById: viewer.id,
      },
    });
    return { message: '动态已删除' };
  }

  async setLike(id: string, viewer: Viewer, active: boolean) {
    await this.assertVisible(id, viewer.id);
    return this.prisma.$transaction(async (tx) => {
      if (active) {
        const created = await tx.momentLike.createMany({ data: [{ momentId: id, userId: viewer.id }], skipDuplicates: true });
        if (created.count > 0) await tx.moment.update({ where: { id }, data: { likeCount: { increment: 1 } } });
      } else {
        const removed = await tx.momentLike.deleteMany({ where: { momentId: id, userId: viewer.id } });
        if (removed.count > 0) await tx.moment.update({ where: { id }, data: { likeCount: { decrement: 1 } } });
      }
      const moment = await tx.moment.findUniqueOrThrow({ where: { id }, select: { likeCount: true } });
      return { momentId: id, count: moment.likeCount, active };
    });
  }

  async setBookmark(id: string, viewer: Viewer, active: boolean) {
    await this.assertVisible(id, viewer.id);
    return this.prisma.$transaction(async (tx) => {
      if (active) {
        const created = await tx.momentBookmark.createMany({ data: [{ momentId: id, userId: viewer.id }], skipDuplicates: true });
        if (created.count > 0) await tx.moment.update({ where: { id }, data: { bookmarkCount: { increment: 1 } } });
      } else {
        const removed = await tx.momentBookmark.deleteMany({ where: { momentId: id, userId: viewer.id } });
        if (removed.count > 0) await tx.moment.update({ where: { id }, data: { bookmarkCount: { decrement: 1 } } });
      }
      const moment = await tx.moment.findUniqueOrThrow({ where: { id }, select: { bookmarkCount: true } });
      return { momentId: id, count: moment.bookmarkCount, active };
    });
  }

  async listUserMoments(userId: string, cursor: string | undefined, limit = 20, viewer?: Viewer) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在');
    const take = Math.min(limit, MAX_PAGE_SIZE);
    const decoded = cursor ? decodeDateCursor(cursor) : undefined;
    const rows = await this.prisma.moment.findMany({
      where: {
        authorId: userId,
        deletedAt: null,
        ...this.viewerVisibility(viewer?.id),
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: this.cardSelect(viewer?.id),
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take) as MomentCardRow[];
    const last = page.at(-1);
    return paginate(page.map(mapMomentCard), {
      cursor: last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    });
  }

  async listBookmarks(cursor: string | undefined, limit = 20, viewer: Viewer) {
    const take = Math.min(limit, MAX_PAGE_SIZE);
    if (cursor) {
      const valid = await this.prisma.momentBookmark.findFirst({ where: { id: cursor, userId: viewer.id }, select: { id: true } });
      if (!valid) throw new BadRequestException('无效的收藏分页游标');
    }
    const bookmarks = await this.prisma.momentBookmark.findMany({
      where: { userId: viewer.id, moment: { deletedAt: null, ...this.viewerVisibility(viewer.id) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: take + 1,
      select: { id: true, moment: { select: this.cardSelect(viewer.id) } },
    });
    const hasMore = bookmarks.length > take;
    const page = bookmarks.slice(0, take);
    return paginate(page.map((bookmark) => mapMomentCard(bookmark.moment as MomentCardRow)), {
      cursor: page.at(-1)?.id ?? null,
      hasMore,
    });
  }

  async search(q: string, cursor: string | undefined, limit = 20, viewer?: Viewer) {
    const keyword = q.trim();
    if (Array.from(keyword).length < 2) throw new BadRequestException('动态搜索至少需要 2 个字符');
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
    const ranked = await this.prisma.$queryRaw<Array<{ id: string; relevance: number; createdAt: Date }>>(Prisma.sql`
      WITH ranked AS (
        SELECT m.id,
          (similarity(m.title, ${keyword}) * 2 + similarity(m.content, ${keyword}))::double precision AS relevance,
          m."created_at" AS "createdAt"
        FROM "moments" m
        INNER JOIN "users" u ON u.id = m."author_id" AND u."deleted_at" IS NULL
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
    const cards = await this.loadCards(page.map((row) => row.id), viewer?.id);
    const relevanceById = new Map(page.map((row) => [row.id, row.relevance]));
    const last = page.at(-1);
    return paginate(cards.map((card) => ({ ...card, relevance: relevanceById.get(card.id) })), {
      cursor: last ? encodeCursor({ relevance: last.relevance, createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    });
  }

  async assertVisible(id: string, viewerId?: string) {
    const moment = await this.prisma.moment.findFirst({
      where: { id, deletedAt: null, ...this.viewerVisibility(viewerId) },
      select: { id: true, authorId: true, title: true },
    });
    if (!moment) throw new NotFoundException('动态不存在');
    return moment;
  }

  private async listDiscover(cursor: string | undefined, limit: number, viewer?: Viewer) {
    const take = Math.min(limit, MAX_PAGE_SIZE);
    const decoded = cursor ? decodeDiscoverCursor(cursor) : undefined;
    const asOf = decoded ? new Date(decoded.asOf) : new Date();
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
    const cursorClause = decoded
      ? Prisma.sql`AND (
          ranked.score < ${decoded.score}
          OR (ranked.score = ${decoded.score} AND ranked."createdAt" < ${new Date(decoded.createdAt)})
          OR (ranked.score = ${decoded.score} AND ranked."createdAt" = ${new Date(decoded.createdAt)} AND ranked.id < ${decoded.id})
        )`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<DiscoverRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT m.id, (${scoreExpression})::double precision AS score, m."created_at" AS "createdAt"
        FROM "moments" m
        INNER JOIN "users" u ON u.id = m."author_id" AND u."deleted_at" IS NULL
        WHERE m."deleted_at" IS NULL ${blockClause}
      )
      SELECT id, score, "createdAt" FROM ranked
      WHERE true ${cursorClause}
      ORDER BY score DESC, "createdAt" DESC, id DESC
      LIMIT ${take + 1}
    `);
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const cards = await this.loadCards(page.map((row) => row.id), viewer?.id);
    const last = page.at(-1);
    return paginate(cards, {
      cursor: last ? encodeCursor({ score: last.score, createdAt: last.createdAt.toISOString(), id: last.id, asOf: asOf.toISOString() }) : null,
      hasMore,
    });
  }

  private async listFollowing(cursor: string | undefined, limit: number, viewer: Viewer) {
    const take = Math.min(limit, MAX_PAGE_SIZE);
    const decoded = cursor ? decodeDateCursor(cursor) : undefined;
    const rows = await this.prisma.moment.findMany({
      where: {
        deletedAt: null,
        author: { followers: { some: { followerId: viewer.id } }, ...this.visibleAuthorWhere(viewer.id) },
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: this.cardSelect(viewer.id),
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take) as MomentCardRow[];
    const last = page.at(-1);
    return paginate(page.map(mapMomentCard), {
      cursor: last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    });
  }

  private async loadCards(ids: string[], viewerId?: string) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.moment.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: this.cardSelect(viewerId),
    });
    const byId = new Map(rows.map((row) => [row.id, mapMomentCard(row as MomentCardRow)]));
    return ids.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
  }

  private cardSelect(viewerId?: string): Prisma.MomentSelect {
    return {
      id: true,
      authorId: true,
      author: { select: momentAuthorSelect },
      title: true,
      content: true,
      textCoverTheme: true,
      coverMedia: { select: momentMediaSelect },
      likeCount: true,
      commentCount: true,
      bookmarkCount: true,
      tipTotal: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      likes: { where: { userId: viewerId ?? '__anonymous__' }, take: 1, select: { id: true } },
      bookmarks: { where: { userId: viewerId ?? '__anonymous__' }, take: 1, select: { id: true } },
      _count: { select: { images: true } },
    };
  }

  private detailSelect(viewerId?: string): Prisma.MomentSelect {
    return {
      ...this.cardSelect(viewerId),
      images: { orderBy: { sortOrder: 'asc' }, select: { sortOrder: true, media: { select: momentMediaSelect } } },
    };
  }

  private viewerVisibility(viewerId?: string): Prisma.MomentWhereInput {
    return viewerId ? { author: this.visibleAuthorWhere(viewerId) } : {};
  }

  private visibleAuthorWhere(viewerId: string): Prisma.UserWhereInput {
    return {
      userBlocks: { none: { blockedId: viewerId } },
      blockedBy: { none: { blockerId: viewerId } },
    };
  }

  private resolveCover(mediaIds: string[], requested?: string | null) {
    if (mediaIds.length === 0) {
      if (requested) throw new BadRequestException('无图片动态不能指定图片封面');
      return null;
    }
    const cover = requested || mediaIds[0];
    if (!mediaIds.includes(cover)) throw new BadRequestException('封面必须来自动态图片');
    return cover;
  }

  private async assertMediaUsable(mediaIds: string[], userId: string, currentMomentId?: string) {
    if (mediaIds.length === 0) return;
    const media = await this.prisma.media.findMany({
      where: { id: { in: mediaIds }, userId, status: 'COMPLETED' },
      select: { id: true, momentImages: { select: { momentId: true } } },
    });
    if (media.length !== mediaIds.length) throw new BadRequestException('图片不存在、未处理完成或不属于当前用户');
    const occupied = media.some((item) => item.momentImages.some((image) => image.momentId !== currentMomentId));
    if (occupied) throw new ConflictException('图片已用于其他动态');
  }

  private themeFor(clientRequestId: string) {
    const nibble = Number.parseInt(clientRequestId.replace(/-/g, '').at(-1) ?? '0', 16);
    return TEXT_COVER_THEMES[Number.isFinite(nibble) ? nibble % TEXT_COVER_THEMES.length : 0];
  }
}
