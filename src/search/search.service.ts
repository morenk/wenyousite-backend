import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { attachPlayerCounts, authorSelect } from '../common/prisma-helpers';
import { paginate } from '../common/dto/paginated-result';
import { ThreadAccessService } from '../common/services/thread-access.service';

const SEARCH_POST_LIMIT = 20;
const SEARCH_POSTS_PER_THREAD = 3;
const MIN_POST_SEARCH_LENGTH = 2;

const postSearchSelect = {
  id: true,
  floorNumber: true,
  parentPostId: true,
  content: true,
  createdAt: true,
  author: { select: authorSelect },
  thread: { select: { id: true, title: true } },
  subthread: { select: { id: true, title: true } },
} satisfies Prisma.PostSelect;

interface RankedPostRow {
  id: string;
  relevance: number;
  createdAt: Date;
}

interface SearchPostCursor {
  relevance: number;
  createdAt: string;
  id: string;
}

type PostSearchScope =
  | { type: 'global' }
  | { type: 'thread'; threadId: string };

const keywordLength = (keyword: string) => Array.from(keyword.trim()).length;

function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, '\\$&');
}

function encodePostCursor(row: RankedPostRow): string {
  return Buffer.from(JSON.stringify({
    relevance: row.relevance,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  } satisfies SearchPostCursor)).toString('base64url');
}

function decodePostCursor(cursor: string): SearchPostCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<SearchPostCursor>;
    if (
      typeof value.relevance !== 'number'
      || !Number.isFinite(value.relevance)
      || typeof value.createdAt !== 'string'
      || Number.isNaN(Date.parse(value.createdAt))
      || typeof value.id !== 'string'
      || value.id.length === 0
    ) {
      throw new Error('invalid cursor shape');
    }
    return value as SearchPostCursor;
  } catch {
    throw new BadRequestException('无效的搜索游标');
  }
}

/** 搜索服务：分类查询用户、公开主题帖，以及全站或单帖楼层内容。 */
@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
  ) {}

  /** 兼容旧客户端的一次性聚合搜索；短词不会触发楼层正文扫描。 */
  async search(q: string) {
    const keyword = q?.trim() ?? '';
    if (!keyword) return { users: [], threads: [], posts: [] };

    const postsPromise = keywordLength(keyword) >= MIN_POST_SEARCH_LENGTH
      ? this.searchPosts(keyword).then((page) => page.items)
      : Promise.resolve([]);
    const [users, threads, posts] = await Promise.all([
      this.searchUsers(keyword),
      this.searchThreads(keyword),
      postsPromise,
    ]);
    return { users, threads, posts };
  }

  async searchUsers(q: string) {
    const keyword = q?.trim() ?? '';
    if (!keyword) return [];
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        username: { contains: keyword, mode: 'insensitive' },
      },
      select: { id: true, username: true, avatar: true, bio: true },
      take: 20,
      orderBy: { username: 'asc' },
    });
  }

  async searchThreads(q: string) {
    const keyword = q?.trim() ?? '';
    if (!keyword) return [];
    const threads = await this.prisma.thread.findMany({
      where: {
        deletedAt: null,
        published: true,
        visibility: 'PUBLIC',
        title: { contains: keyword, mode: 'insensitive' },
      },
      select: {
        id: true,
        title: true,
        category: true,
        createdAt: true,
        owner: { select: authorSelect },
        _count: { select: { members: true, posts: true } },
      },
      take: 50,
      orderBy: { updatedAt: 'desc' },
    });
    await attachPlayerCounts(this.prisma, threads);
    return threads;
  }

  /**
   * 搜索公开楼层与楼中楼。相关度优先，时间与 ID 作为稳定次序；
   * 数据库窗口函数限制每个主题帖最多出现三条，避免单帖霸屏。
   */
  async searchPosts(q: string, cursor?: string, limit = SEARCH_POST_LIMIT) {
    return this.searchPostPage(q, cursor, limit, { type: 'global' });
  }

  /** 搜索单个主题帖内的全部楼层；可见性由统一主题访问规则控制。 */
  async searchThreadPosts(
    threadId: string,
    q: string,
    cursor?: string,
    limit = SEARCH_POST_LIMIT,
    userId?: string,
  ) {
    await this.threadAccess.assertAccessible(threadId, userId);
    return this.searchPostPage(q, cursor, limit, { type: 'thread', threadId });
  }

  /** 全站与帖内查询共享短词校验、相关度排序、游标和展示字段。 */
  private async searchPostPage(
    q: string,
    cursor: string | undefined,
    limit: number,
    scope: PostSearchScope,
  ) {
    const keyword = q?.trim() ?? '';
    if (keywordLength(keyword) < MIN_POST_SEARCH_LENGTH) {
      throw new BadRequestException('楼层内容搜索至少需要 2 个字符');
    }

    const take = Math.max(1, Math.min(limit, SEARCH_POST_LIMIT));
    const decodedCursor = cursor ? decodePostCursor(cursor) : undefined;
    const cursorDate = decodedCursor ? new Date(decodedCursor.createdAt) : undefined;
    const cursorCondition = decodedCursor && cursorDate
      ? Prisma.sql`
          AND (
            ranked.relevance < ${decodedCursor.relevance}
            OR (ranked.relevance = ${decodedCursor.relevance} AND ranked."createdAt" < ${cursorDate})
            OR (
              ranked.relevance = ${decodedCursor.relevance}
              AND ranked."createdAt" = ${cursorDate}
              AND ranked.id < ${decodedCursor.id}
            )
          )`
      : Prisma.empty;
    const likePattern = `%${escapeLikePattern(keyword)}%`;
    const threadRankSelect = scope.type === 'global'
      ? Prisma.sql`,
          ROW_NUMBER() OVER (
            PARTITION BY p."thread_id"
            ORDER BY similarity(p."content", ${keyword}) DESC, p."created_at" DESC, p."id" DESC
          ) AS "threadRank"`
      : Prisma.empty;
    const threadScopeCondition = scope.type === 'global'
      ? Prisma.sql`
          AND t."published" = true
          AND t."visibility" = 'PUBLIC'`
      : Prisma.sql`AND t."id" = ${scope.threadId}`;
    const threadRankCondition = scope.type === 'global'
      ? Prisma.sql`AND ranked."threadRank" <= ${SEARCH_POSTS_PER_THREAD}`
      : Prisma.empty;

    const rankedRows = await this.prisma.$queryRaw<RankedPostRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          p."id" AS id,
          similarity(p."content", ${keyword})::double precision AS relevance,
          p."created_at" AS "createdAt"
          ${threadRankSelect}
        FROM "posts" p
        INNER JOIN "threads" t ON t."id" = p."thread_id"
        INNER JOIN "subthreads" s ON s."id" = p."subthread_id"
        WHERE p."deleted_at" IS NULL
          AND p."kind" = 'FLOOR'
          AND p."content" ILIKE ${likePattern} ESCAPE '\\'
          AND t."deleted_at" IS NULL
          ${threadScopeCondition}
          AND s."deleted_at" IS NULL
      )
      SELECT ranked.id, ranked.relevance, ranked."createdAt"
      FROM ranked
      WHERE true
      ${threadRankCondition}
      ${cursorCondition}
      ORDER BY ranked.relevance DESC, ranked."createdAt" DESC, ranked.id DESC
      LIMIT ${take + 1}
    `);

    const hasMore = rankedRows.length > take;
    const pageRows = rankedRows.slice(0, take);
    const ids = pageRows.map((row) => row.id);
    const unorderedPosts = ids.length > 0
      ? await this.prisma.post.findMany({
          where: { id: { in: ids } },
          select: postSearchSelect,
        })
      : [];
    const postById = new Map(unorderedPosts.map((post) => [post.id, post]));
    const posts = ids.flatMap((id) => {
      const post = postById.get(id);
      return post ? [post] : [];
    });
    const lastRow = pageRows.at(-1);

    return paginate(posts, {
      cursor: lastRow ? encodePostCursor(lastRow) : null,
      hasMore,
    });
  }
}
