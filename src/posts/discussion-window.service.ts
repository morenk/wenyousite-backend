import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostQueryService } from './post-query.service';
import { visiblePostWhere, unblockedUserSql } from '../access/block-visibility.where';
import { authorSelect, includeDiceRolls } from '../common/prisma-helpers';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { DiscussionWindowQueryDto } from './dto/discussion-window.dto';
import {
  decodeDiscussionCursor,
  DiscussionCursorContext,
  encodeDiscussionCursor,
} from './discussion-cursor';

@Injectable()
export class DiscussionWindowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: PostQueryService,
    private readonly config: ConfigService,
  ) {}

  async find(
    scope: 'floors' | 'replies',
    scopeId: string,
    query: DiscussionWindowQueryDto,
    userId?: string,
  ) {
    if (
      [query.number, query.postId, query.cursor].filter((value) => value !== undefined).length > 1
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'number、postId、cursor 只能提供一个');
    }
    const field = scope === 'floors' ? 'floorNumber' : 'replyNumber';
    const order = query.order ?? ReplyOrder.OLDEST;
    const ascending = order === ReplyOrder.OLDEST;
    const direction = ascending ? 'asc' : 'desc';
    const reverse = ascending ? 'desc' : 'asc';
    const take = Math.min(query.limit ?? 20, 50);
    const context: DiscussionCursorContext = {
      scope,
      scopeId,
      order,
      authorId: query.authorId ?? null,
      viewerId: userId ?? null,
    };
    const secret = this.config.getOrThrow<string>('jwt.accessSecret');
    const cursor = query.cursor ? decodeDiscussionCursor(query.cursor, context, secret) : null;
    const base: Prisma.PostWhereInput = {
      ...(scope === 'floors'
        ? { subthreadId: scopeId, kind: 'FLOOR', parentPostId: null }
        : { parentPostId: scopeId }),
      ...visiblePostWhere(userId),
      [field]: { not: null },
    };
    const include = {
      author: { select: authorSelect },
      ...includeDiceRolls(),
      replyToPost: {
        where: visiblePostWhere(userId),
        select: { id: true, authorId: true, author: { select: authorSelect } },
      },
    } satisfies Prisma.PostInclude;
    // 同一短快照内取得目标、集合统计和边界；窗口大小不随目标距离增长。
    return this.prisma.$transaction(
      async (tx) => {
        // 父范围与作者资格首次读取即在同一快照，避免外层检查和正文读取之间的竞态。
        const parent =
          scope === 'floors'
            ? await this.queries.findSubthreadContext(scopeId, userId, tx)
            : await this.queries.findDiscussionRoot(scopeId, userId, tx);
        const eligible =
          !query.authorId ||
          (await this.queries.isEligibleDiscussionAuthor(
            parent.threadId,
            parent.thread.ownerId,
            query.authorId,
            tx,
          ));
        const where: Prisma.PostWhereInput = {
          ...base,
          ...(query.authorId ? { authorId: query.authorId } : {}),
          ...(!eligible ? { id: { in: [] } } : {}),
        };
        let target: { id: string; number: number } | null = null;
        if (query.number !== undefined || query.postId !== undefined) {
          const row = await tx.post.findFirst({
            where: {
              ...base,
              ...(query.postId !== undefined ? { id: query.postId } : { [field]: query.number }),
            },
            select: { id: true, authorId: true, floorNumber: true, replyNumber: true },
          });
          if (!row) throw notFound(ErrorCode.POST_NOT_FOUND, '该编号或回复当前不可用');
          if (!eligible || (query.authorId && row.authorId !== query.authorId)) {
            throw new BusinessException(
              ErrorCode.DISCUSSION_TARGET_FILTERED,
              '目标被当前作者筛选排除，请清除筛选后重试',
              HttpStatus.CONFLICT,
            );
          }
          target = { id: row.id, number: row[field]! };
        }
        const stats = await tx.post.aggregate({
          where,
          _count: true,
          _max: { floorNumber: true, replyNumber: true },
        });
        const maximum = query.authorId
          ? await tx.post.aggregate({ where: base, _max: { floorNumber: true, replyNumber: true } })
          : stats;
        const numberWhere = (
          number: number,
          side: 'before' | 'after',
          inclusive = false,
        ): Prisma.PostWhereInput => ({
          AND: [
            where,
            {
              [field]: {
                [(side === 'after') === ascending
                  ? inclusive
                    ? 'gte'
                    : 'gt'
                  : inclusive
                    ? 'lte'
                    : 'lt']: number,
              },
            },
          ],
        });
        let rows;
        if (target) {
          const before = await tx.post.findMany({
            where: numberWhere(target.number, 'before'),
            orderBy: { [field]: reverse },
            take: Math.floor((take - 1) / 2),
            select: { id: true, floorNumber: true, replyNumber: true },
          });
          const after = await tx.post.findMany({
            where: numberWhere(target.number, 'after', true),
            orderBy: { [field]: direction },
            take: take - before.length,
            select: { id: true, floorNumber: true, replyNumber: true },
          });
          rows = [...before.reverse(), ...after];
        } else if (cursor) {
          rows = await tx.post.findMany({
            where: numberWhere(cursor.number, cursor.direction),
            orderBy: { [field]: cursor.direction === 'before' ? reverse : direction },
            take,
            select: { id: true, floorNumber: true, replyNumber: true },
          });
          if (cursor.direction === 'before') rows.reverse();
        } else {
          rows = await tx.post.findMany({
            where,
            orderBy: { [field]: direction },
            take,
            select: { id: true, floorNumber: true, replyNumber: true },
          });
        }
        const first = rows[0]?.[field];
        const last = rows.at(-1)?.[field];
        const hasBefore =
          first != null &&
          Boolean(
            await tx.post.findFirst({ where: numberWhere(first, 'before'), select: { id: true } }),
          );
        const hasAfter =
          last != null &&
          Boolean(
            await tx.post.findFirst({ where: numberWhere(last, 'after'), select: { id: true } }),
          );
        const pinned =
          scope === 'floors' && !target && !cursor
            ? await tx.post.findMany({
                where: { ...where, pinnedAt: { not: null } },
                orderBy: [{ pinnedAt: 'desc' }, { id: 'desc' }],
                take: 10,
                select: { id: true, floorNumber: true, replyNumber: true },
              })
            : [];
        // LATERAL 使用 parent/reply 索引，每个父楼最多选五个 ID，避免 ORM 载入全部回复后截断。
        const decorate = async (refs: typeof rows) => {
          const loaded = refs.length
            ? await tx.post.findMany({
                where: {
                  id: { in: [...new Set(refs.map((row) => row.id))] },
                  ...visiblePostWhere(userId),
                },
                include,
              })
            : [];
          const byId = new Map(loaded.map((row) => [row.id, row]));
          const posts = refs.map((row) => byId.get(row.id)!).filter(Boolean);
          if (scope === 'replies') return posts;
          const ids = [...new Set(posts.map((row) => row.id))];
          const replyIds = ids.length
            ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT candidate.id FROM unnest(${ids}::text[]) AS parent(id)
          CROSS JOIN LATERAL (
            SELECT p.id FROM posts p WHERE p.parent_post_id = parent.id AND p.deleted_at IS NULL
            ${unblockedUserSql(userId, Prisma.sql`p.author_id`)}
            ORDER BY p.reply_number ASC LIMIT 5
          ) AS candidate
        `)
            : [];
          const replies = replyIds.length
            ? await tx.post.findMany({
                where: {
                  id: { in: replyIds.map((reply) => reply.id) },
                  ...visiblePostWhere(userId),
                },
                orderBy: { replyNumber: 'asc' },
                include,
              })
            : [];
          const counts = ids.length
            ? await tx.post.groupBy({
                by: ['parentPostId'],
                where: { parentPostId: { in: ids }, ...visiblePostWhere(userId) },
                _count: true,
              })
            : [];
          const countById = new Map(counts.map((row) => [row.parentPostId, row._count]));
          return posts.map((row) => ({
            _count: { replies: countById.get(row.id) ?? 0 },
            ...row,
            replies: replies.filter((reply) => reply.parentPostId === row.id),
          }));
        };
        const decorated = await decorate([...rows, ...pinned]);
        return {
          items: decorated.slice(0, rows.length),
          pinnedItems: decorated.slice(rows.length),
          total: stats._count,
          maxNumber: maximum._max[field],
          target,
          beforeCursor: hasBefore
            ? encodeDiscussionCursor(
                { ...context, version: 1, number: first!, direction: 'before' },
                secret,
              )
            : null,
          afterCursor: hasAfter
            ? encodeDiscussionCursor(
                { ...context, version: 1, number: last!, direction: 'after' },
                secret,
              )
            : null,
          hasBefore,
          hasAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
