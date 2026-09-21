import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { unblockedUserSql } from '../access/block-visibility.where';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { GalleryScope } from './gallery.dto';
import { GallerySession, GalleryBoundary } from './gallery-cursor';
import { GalleryContext } from './gallery-access.service';
export type GalleryRow = GalleryBoundary & {
  imageCount: number;
  url: string;
  mediaId: string | null;
  threadId: string | null;
  subthreadId: string | null;
  parentPostId: string | null;
  momentId: string | null;
  parentCommentId: string | null;
  floorNumber: number | null;
};
@Injectable()
export class GalleryRowsService {
  constructor(private readonly prisma: PrismaService) {}
  private source(session: GallerySession, context: GalleryContext, eligible: boolean): Prisma.Sql {
    const { scope, scopeId, viewerId, authorId, snapshot } = session;
    const sign = session.order === ReplyOrder.NEWEST ? -1 : 1;
    if (scope === GalleryScope.SUBTHREAD || scope === GalleryScope.POST_REPLIES) {
      const pins = session.pinnedIds;
      const pinRank = pins.length
        ? Prisma.sql`array_position(ARRAY[${Prisma.join(pins)}]::text[], p.id)`
        : Prisma.sql`NULL::integer`;
      const group =
        scope === GalleryScope.POST_REPLIES
          ? Prisma.sql`0`
          : Prisma.sql`CASE WHEN p.kind = 'BODY' THEN 0 WHEN ${pinRank} IS NOT NULL THEN 1 ELSE 2 END`;
      const time =
        scope === GalleryScope.POST_REPLIES
          ? Prisma.sql`EXTRACT(EPOCH FROM p.created_at) * 1000 * ${sign}`
          : Prisma.sql`CASE WHEN p.kind = 'BODY' THEN 0 WHEN ${pinRank} IS NOT NULL THEN ${pinRank} ELSE p.floor_number * ${sign} END`;
      return Prisma.sql`
        SELECT p.id AS "sourceId", p.lock_version AS "sourceVersion", i.image_index AS "imageIndex",
          i.image_count AS "imageCount", i.url, NULL::text AS "mediaId", p.thread_id AS "threadId",
          p.subthread_id AS "subthreadId", p.parent_post_id AS "parentPostId", NULL::text AS "momentId",
          NULL::text AS "parentCommentId", p.floor_number AS "floorNumber", ${group}::integer AS "groupKey", ${time}::double precision AS "timeKey"
        FROM post_image_occurrences i JOIN posts p ON p.id = i.post_id
        WHERE p.deleted_at IS NULL AND p.created_at <= ${new Date(snapshot)}
          AND ${scope === GalleryScope.SUBTHREAD ? Prisma.sql`p.subthread_id = ${scopeId} AND p.parent_post_id IS NULL` : Prisma.sql`p.parent_post_id = ${scopeId} AND p.kind = 'FLOOR'`}
          AND ${eligible ? Prisma.sql`TRUE` : Prisma.sql`p.kind = 'BODY'`}
          ${authorId ? Prisma.sql`AND (p.kind = 'BODY' OR p.author_id = ${authorId})` : Prisma.empty}
          ${unblockedUserSql(viewerId ?? undefined, Prisma.sql`p.author_id`)}
      `;
    }
    if (scope === GalleryScope.MOMENT)
      return Prisma.sql`
      SELECT m.id AS "sourceId", m.lock_version AS "sourceVersion", mi.sort_order AS "imageIndex",
        (SELECT COUNT(*)::integer FROM moment_images count_i WHERE count_i.moment_id = m.id) AS "imageCount",
        asset.url, mi.media_id AS "mediaId", NULL::text AS "threadId", NULL::text AS "subthreadId", NULL::text AS "parentPostId",
        m.id AS "momentId", NULL::text AS "parentCommentId", NULL::integer AS "floorNumber", 0 AS "groupKey", 0::double precision AS "timeKey"
      FROM moment_images mi JOIN moments m ON m.id = mi.moment_id JOIN media asset ON asset.id = mi.media_id
      WHERE mi.moment_id = ${scopeId} AND m.deleted_at IS NULL AND asset.status = 'COMPLETED' AND asset.deletion_claimed_at IS NULL
        AND m.created_at <= ${new Date(snapshot)}
    `;
    return Prisma.sql`
      SELECT c.id AS "sourceId", 1 AS "sourceVersion", 0 AS "imageIndex", 1 AS "imageCount",
        asset.url, c.media_id AS "mediaId", NULL::text AS "threadId", NULL::text AS "subthreadId", NULL::text AS "parentPostId",
        c.moment_id AS "momentId", c.parent_comment_id AS "parentCommentId", NULL::integer AS "floorNumber",
        0 AS "groupKey", (EXTRACT(EPOCH FROM c.created_at) * 1000 * ${sign})::double precision AS "timeKey"
      FROM moment_comments c JOIN media asset ON asset.id = c.media_id
      WHERE c.moment_id = ${context.momentId} AND c.deleted_at IS NULL AND c.created_at <= ${new Date(snapshot)}
        AND asset.status = 'COMPLETED' AND asset.deletion_claimed_at IS NULL
        AND ${scope === GalleryScope.MOMENT_COMMENTS ? Prisma.sql`c.parent_comment_id IS NULL` : Prisma.sql`c.parent_comment_id = ${scopeId}`}
        ${authorId ? Prisma.sql`AND c.author_id = ${authorId}` : Prisma.empty}
        ${unblockedUserSql(viewerId ?? undefined, Prisma.sql`c.author_id`)}
    `;
  }
  /** 事务快照排除打开时仍未提交的正文编辑；置顶不写内容事务号。 */
  async contentChanged(session: GallerySession) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM posts p JOIN post_gallery_indexes gi ON gi.post_id = p.id WHERE p.deleted_at IS NULL AND p.created_at <= ${new Date(session.snapshot)}
        AND ${session.scope === GalleryScope.SUBTHREAD ? Prisma.sql`p.subthread_id = ${session.scopeId} AND p.parent_post_id IS NULL` : Prisma.sql`p.parent_post_id = ${session.scopeId} AND p.kind = 'FLOOR'`}
        ${session.authorId ? Prisma.sql`AND (p.kind = 'BODY' OR p.author_id = ${session.authorId})` : Prisma.empty}
        ${unblockedUserSql(session.viewerId ?? undefined, Prisma.sql`p.author_id`)}
        AND NOT txid_visible_in_snapshot(gi.content_transaction, ${session.snapshotTx}::txid_snapshot)
      LIMIT 1
    `);
    return rows.length > 0;
  }
  async anchor(
    session: GallerySession,
    context: GalleryContext,
    eligible: boolean,
    sourceId: string,
    imageIndex: number,
  ) {
    const rows = await this.prisma.$queryRaw<
      GalleryRow[]
    >(Prisma.sql`WITH images AS (${this.source(session, context, eligible)})
      SELECT * FROM images WHERE "sourceId" = ${sourceId} AND "imageIndex" = ${imageIndex} LIMIT 1`);
    return rows[0];
  }
  async adjacent(
    session: GallerySession,
    context: GalleryContext,
    eligible: boolean,
    boundary: GalleryBoundary,
    direction: 'before' | 'after',
    limit: number,
  ) {
    const after = direction === 'after';
    const op = after ? Prisma.sql`>` : Prisma.sql`<`;
    const idOp = (session.order === ReplyOrder.NEWEST) !== after ? Prisma.sql`>` : Prisma.sql`<`;
    const sequence = after ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const idSequence =
      (session.order === ReplyOrder.NEWEST) !== after ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const rows = await this.prisma.$queryRaw<GalleryRow[]>(Prisma.sql`
      WITH images AS (${this.source(session, context, eligible)}) SELECT * FROM images WHERE
        "groupKey" ${op} ${boundary.groupKey}
        OR ("groupKey" = ${boundary.groupKey} AND "timeKey" ${op} ${boundary.timeKey})
        OR ("groupKey" = ${boundary.groupKey} AND "timeKey" = ${boundary.timeKey} AND "sourceId" ${idOp} ${boundary.sourceId})
        OR ("groupKey" = ${boundary.groupKey} AND "timeKey" = ${boundary.timeKey} AND "sourceId" = ${boundary.sourceId} AND "imageIndex" ${op} ${boundary.imageIndex})
      ORDER BY "groupKey" ${sequence}, "timeKey" ${sequence}, "sourceId" ${idSequence}, "imageIndex" ${sequence} LIMIT ${limit}
    `);
    return after ? rows : rows.reverse();
  }
}
