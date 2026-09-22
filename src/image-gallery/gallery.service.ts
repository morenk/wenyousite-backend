import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { visiblePostWhere, visibleUserWhere } from '../access/block-visibility.where';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { readMediaDisplay } from '../media/media-display';
import { GalleryImageDto, GalleryPageDto, GalleryQueryDto, GalleryScope } from './gallery.dto';
import { GalleryAccessService, GalleryContext } from './gallery-access.service';
import { GalleryRowsService, GalleryRow } from './gallery-rows.service';
import {
  decodeGalleryCursor,
  encodeGalleryCursor,
  GallerySession,
  GalleryBoundary,
  invalidCursor,
} from './gallery-cursor';

function changed(): never {
  throw new BusinessException(
    ErrorCode.CONFLICT,
    '图片内容已变化，请重新打开',
    HttpStatus.CONFLICT,
  );
}
@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GalleryAccessService,
    private readonly rows: GalleryRowsService,
    private readonly config: ConfigService,
  ) {}
  async list(query: GalleryQueryDto, viewerId?: string): Promise<GalleryPageDto> {
    const order =
      query.order ??
      (query.scope === GalleryScope.MOMENT_COMMENTS ? ReplyOrder.NEWEST : ReplyOrder.OLDEST);
    const secret = this.config.getOrThrow<string>('jwt.accessSecret');
    const cursor = query.cursor ? decodeGalleryCursor(query.cursor, secret) : null;
    if (
      cursor &&
      (cursor.session.scope !== query.scope ||
        cursor.session.scopeId !== query.scopeId ||
        cursor.session.order !== order ||
        cursor.session.authorId !== (query.authorId ?? null) ||
        cursor.session.viewerId !== (viewerId ?? null))
    )
      return invalidCursor();
    if (query.scope === GalleryScope.MOMENT && query.authorId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '动态正文不支持作者筛选');
    const context = await this.access.assert(query.scope, query.scopeId, viewerId);
    const eligible = await this.access.eligibleAuthor(context, query.authorId);
    const session = cursor?.session ?? (await this.session(query, order, viewerId));
    await this.assertIndexedAndUnchanged(session);
    const sourceId = cursor?.boundary.sourceId ?? query.anchorId;
    const imageIndex = cursor?.boundary.imageIndex ?? query.anchorIndex;
    const version = cursor?.boundary.sourceVersion ?? query.anchorVersion;
    if (!sourceId || imageIndex === undefined || version === undefined) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '首次打开需要完整图片锚点');
    }
    const anchor = await this.rows.anchor(session, context, eligible, sourceId, imageIndex);
    if (!anchor) {
      // 先核实来源可见性，权限丢失不能以可保留缓存的网络错误呈现。
      await this.assertSourceVisible(session, context, sourceId, eligible);
      return changed();
    }
    if (
      anchor.sourceVersion !== version ||
      (cursor &&
        (anchor.groupKey !== cursor.boundary.groupKey ||
          anchor.timeKey !== cursor.boundary.timeKey))
    )
      return changed();
    const take = query.limit ?? 20;
    let page: GalleryRow[];
    if (cursor) {
      page = await this.rows.adjacent(session, context, eligible, anchor, cursor.direction, take);
    } else {
      const before = await this.rows.adjacent(
        session,
        context,
        eligible,
        anchor,
        'before',
        Math.floor((take - 1) / 2),
      );
      const after = await this.rows.adjacent(
        session,
        context,
        eligible,
        anchor,
        'after',
        take - before.length - 1,
      );
      page = [...before, anchor, ...after];
    }
    const first = page[0] ?? anchor;
    const last = page.at(-1) ?? anchor;
    const [previous, next, items] = await Promise.all([
      this.rows.adjacent(session, context, eligible, first, 'before', 1),
      this.rows.adjacent(session, context, eligible, last, 'after', 1),
      this.enrich(page),
    ]);
    // 权限条件可能在查询期间改变；交付前再检查整个阅读范围。
    await this.access.assert(query.scope, query.scopeId, viewerId);
    await this.assertIndexedAndUnchanged(session);
    const token = (boundary: GalleryBoundary, direction: 'before' | 'after') =>
      encodeGalleryCursor(
        {
          version: 1,
          session,
          boundary: {
            sourceId: boundary.sourceId,
            sourceVersion: boundary.sourceVersion,
            imageIndex: boundary.imageIndex,
            groupKey: boundary.groupKey,
            timeKey: boundary.timeKey,
          },
          direction,
        },
        secret,
      );
    return {
      items,
      previousCursor: previous.length ? token(first, 'before') : null,
      nextCursor: next.length ? token(last, 'after') : null,
      anchorItemId: cursor ? null : this.itemId(anchor),
    };
  }
  private async session(
    query: GalleryQueryDto,
    order: ReplyOrder,
    viewerId?: string,
  ): Promise<GallerySession> {
    const [{ snapshotTx }] = await this.prisma.$queryRaw<
      { snapshotTx: string }[]
    >`SELECT txid_current_snapshot()::text AS "snapshotTx"`;
    // 极端并发下拒绝建立过大的快照，不能产出超过查询参数上限的游标。
    if (snapshotTx.length > 2048)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '图片浏览暂时繁忙，请重新打开',
        HttpStatus.CONFLICT,
      );
    const snapshot = Date.now();
    const pinned =
      query.scope === GalleryScope.SUBTHREAD
        ? await this.prisma.post.findMany({
            where: {
              ...visiblePostWhere(viewerId),
              subthreadId: query.scopeId,
              kind: 'FLOOR',
              parentPostId: null,
              pinnedAt: { not: null },
              createdAt: { lte: new Date(snapshot) },
              ...(query.authorId ? { authorId: query.authorId } : {}),
            },
            orderBy: [{ pinnedAt: 'desc' }, { id: 'desc' }],
            take: 10,
            select: { id: true },
          })
        : [];
    return {
      scope: query.scope,
      scopeId: query.scopeId,
      order,
      authorId: query.authorId ?? null,
      viewerId: viewerId ?? null,
      snapshot,
      snapshotTx,
      pinnedIds: pinned.map((post) => post.id),
    };
  }
  private async assertIndexedAndUnchanged(session: GallerySession) {
    if (![GalleryScope.SUBTHREAD, GalleryScope.POST_REPLIES].includes(session.scope)) return;
    const where = {
      ...this.access.postWhere(session.scope, session.scopeId, session.viewerId ?? undefined),
      createdAt: { lte: new Date(session.snapshot) },
      ...(session.authorId
        ? { AND: [{ OR: [{ kind: 'BODY' as const }, { authorId: session.authorId }] }] }
        : {}),
    };
    const missing = await this.prisma.post.findFirst({
      where: { ...where, galleryIndex: { is: null } },
      select: { id: true },
    });
    if (missing)
      throw new BusinessException(
        ErrorCode.IMAGE_GALLERY_NOT_READY,
        '图片图集尚未就绪，请稍后重新打开',
        HttpStatus.CONFLICT,
      );
    const edited = await this.rows.contentChanged(session);
    if (edited) return changed();
  }
  private async assertSourceVisible(
    session: GallerySession,
    context: GalleryContext,
    sourceId: string,
    eligible: boolean,
  ) {
    if (context.threadId) {
      const row = await this.prisma.post.findFirst({
        where: {
          id: sourceId,
          ...this.access.postWhere(session.scope, session.scopeId, session.viewerId ?? undefined),
          ...(session.authorId
            ? { AND: [{ OR: [{ kind: 'BODY' }, { authorId: session.authorId }] }] }
            : {}),
        },
        select: { kind: true },
      });
      if (!row || (!eligible && row.kind !== 'BODY')) throw notFound();
    } else if (session.scope === GalleryScope.MOMENT) {
      if (sourceId !== context.momentId) throw notFound();
    } else {
      const row = await this.prisma.momentComment.findFirst({
        where: {
          id: sourceId,
          momentId: context.momentId!,
          deletedAt: null,
          parentCommentId: session.scope === GalleryScope.MOMENT_COMMENTS ? null : session.scopeId,
          ...(session.authorId ? { authorId: session.authorId } : {}),
          author: visibleUserWhere(session.viewerId ?? undefined),
        },
        select: { id: true },
      });
      if (!row) throw notFound();
    }
  }
  private itemId(row: GalleryRow) {
    return `${row.threadId ? 'post' : row.parentCommentId || (row.imageCount === 1 && row.sourceId !== row.momentId) ? 'comment' : 'moment'}:${row.sourceId}:${row.sourceVersion}:${row.imageIndex}`;
  }
  private async enrich(rows: GalleryRow[]): Promise<GalleryImageDto[]> {
    const media = rows.length
      ? await this.prisma.media.findMany({
          where: {
            status: 'COMPLETED',
            deletionClaimedAt: null,
            OR: [
              { id: { in: rows.flatMap((row) => (row.mediaId ? [row.mediaId] : [])) } },
              {
                postAttachments: {
                  some: {
                    postId: { in: rows.filter((row) => row.threadId).map((row) => row.sourceId) },
                  },
                },
                url: { in: rows.map((row) => row.url) },
              },
            ],
          },
          select: {
            id: true,
            url: true,
            width: true,
            height: true,
            animated: true,
            displayAsset: true,
            postAttachments: { select: { postId: true } },
          },
        })
      : [];
    return rows.map((row) => {
      const matches = media.filter(
        (asset) =>
          asset.url === row.url &&
          (row.mediaId
            ? asset.id === row.mediaId
            : asset.postAttachments.some((ref) => ref.postId === row.sourceId)),
      );
      const asset = matches.length === 1 ? matches[0] : null;
      return {
        id: this.itemId(row),
        sourceId: row.sourceId,
        sourceVersion: row.sourceVersion,
        imageIndex: row.imageIndex,
        imageCount: row.imageCount,
        url: row.url,
        mediaId: asset?.id ?? null,
        display: readMediaDisplay(asset?.displayAsset),
        width: asset?.width ?? null,
        height: asset?.height ?? null,
        animated: asset?.animated ?? false,
        threadId: row.threadId,
        subthreadId: row.subthreadId,
        parentPostId: row.parentPostId,
        momentId: row.momentId,
        parentCommentId: row.parentCommentId,
        floorNumber: row.floorNumber,
      };
    });
  }
}
