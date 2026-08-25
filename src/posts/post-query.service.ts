import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notFound } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';
import {
  notDeleted,
  authorSelect,
  countNonDeletedReplies,
  includeDiceRolls,
} from '../common/prisma-helpers';
import { ReplyOrder } from '../common/dto/reply-query.dto';

const floorReplyInclude = {
  author: { select: authorSelect },
  ...includeDiceRolls(),
  replyToPost: {
    select: { id: true, authorId: true, author: { select: authorSelect } },
  },
} satisfies Prisma.PostInclude;

type FloorReply = Prisma.PostGetPayload<{ include: typeof floorReplyInclude }>;

/** 帖子读模型：楼层、楼中楼和导航上下文查询。 */
@Injectable()
export class PostQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
  ) {}

  private async findSubthreadContext(subthreadId: string, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      select: { id: true, threadId: true, thread: { select: { ownerId: true } } },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertAccessible(subthread.threadId, userId);
    return subthread;
  }

  private async findDiscussionRoot(postId: string, userId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: {
        id: true,
        threadId: true,
        kind: true,
        parentPostId: true,
        thread: { select: { ownerId: true } },
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!post || post.subthread.deletedAt || post.kind !== 'FLOOR' || post.parentPostId !== null) {
      throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    }
    await this.threadAccess.assertAccessible(post.threadId, userId);
    return post;
  }

  /** 获取子贴的楼层列表（Cursor 分页），内嵌每个楼层的前 5 条楼中楼回复。已软删子贴返回 404 */
  async findAllBySubthread(
    subthreadId: string,
    cursor?: string,
    limit = 20,
    userId?: string,
    order = ReplyOrder.OLDEST,
    authorId?: string,
  ) {
    const subthread = await this.findSubthreadContext(subthreadId, userId);

    if (
      authorId &&
      !(await this.isEligibleDiscussionAuthor(
        subthread.threadId,
        subthread.thread.ownerId,
        authorId,
      ))
    ) {
      return paginate([], { cursor: null, hasMore: false });
    }

    const take = Math.min(limit, 50);
    const direction = order === ReplyOrder.NEWEST ? 'desc' : 'asc';
    const posts = await this.prisma.post.findMany({
      where: {
        subthreadId,
        kind: 'FLOOR',
        parentPostId: null,
        ...notDeleted,
        ...(authorId ? { authorId } : {}),
      },
      orderBy: { floorNumber: direction },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: authorSelect },
        ...includeDiceRolls(),
        _count: { select: { replies: { where: notDeleted } } },
      },
    });

    const hasMore = posts.length > take;
    if (hasMore) posts.pop();

    // 为有回复的楼层批量获取前 5 条楼中楼回复
    const floorIdsWithReplies = posts.filter((p) => p._count.replies > 0).map((p) => p.id);
    const repliesMap = new Map<string, FloorReply[]>();
    if (floorIdsWithReplies.length > 0) {
      // 窗口函数先一次性选出每层前 5 条回复，再统一加载关联数据。
      // 查询数固定为 2，避免一页 20 个楼层产生 20 次并行查询。
      const replyIds = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT ranked."id"
        FROM (
          SELECT
            p."id",
            ROW_NUMBER() OVER (
              PARTITION BY p."parent_post_id"
              ORDER BY p."created_at" ASC, p."id" ASC
            ) AS "row_number"
          FROM "posts" AS p
          WHERE p."parent_post_id" IN (${Prisma.join(floorIdsWithReplies)})
            AND p."deleted_at" IS NULL
        ) AS ranked
        WHERE ranked."row_number" <= 5
      `);

      const replies =
        replyIds.length > 0
          ? await this.prisma.post.findMany({
              where: { id: { in: replyIds.map((reply) => reply.id) } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: floorReplyInclude,
            })
          : [];

      for (const reply of replies) {
        const grouped = repliesMap.get(reply.parentPostId!) ?? [];
        grouped.push(reply);
        repliesMap.set(reply.parentPostId!, grouped);
      }
    }

    const items = posts.map((post) => ({
      ...post,
      replies: repliesMap.get(post.id) ?? [],
    }));

    return paginate(items, {
      cursor: posts.length > 0 ? posts[posts.length - 1].id : null,
      hasMore,
    });
  }

  /** 当前子贴中确实发布过主楼层的角色作者候选。 */
  async findFloorAuthors(subthreadId: string, userId?: string) {
    const subthread = await this.findSubthreadContext(subthreadId, userId);
    return this.findEligibleContentAuthors({
      threadId: subthread.threadId,
      ownerId: subthread.thread.ownerId,
      where: {
        subthreadId,
        kind: 'FLOOR',
        parentPostId: null,
        ...notDeleted,
      },
    });
  }

  /** 获取主楼层的楼中楼回复列表（cursor 分页）。已软删子贴或非主楼层返回 404 */
  async findReplies(
    postId: string,
    cursor?: string,
    limit = 20,
    userId?: string,
    order = ReplyOrder.OLDEST,
    authorId?: string,
  ) {
    const post = await this.findDiscussionRoot(postId, userId);

    if (
      authorId &&
      !(await this.isEligibleDiscussionAuthor(post.threadId, post.thread.ownerId, authorId))
    ) {
      return paginate([], { cursor: null, hasMore: false });
    }

    const take = Math.min(limit, 50);
    const direction = order === ReplyOrder.NEWEST ? 'desc' : 'asc';
    const replies = await this.prisma.post.findMany({
      where: { parentPostId: postId, ...notDeleted, ...(authorId ? { authorId } : {}) },
      orderBy: [{ createdAt: direction }, { id: direction }],
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: authorSelect },
        ...includeDiceRolls(),
        replyToPost: { select: { id: true, authorId: true, author: { select: authorSelect } } },
      },
    });
    const hasMore = replies.length > take;
    if (hasMore) replies.pop();
    return paginate(replies, {
      cursor: replies.length > 0 ? replies[replies.length - 1].id : null,
      hasMore,
    });
  }

  /** 当前主楼层下确实发布过楼中楼回复的角色作者候选。 */
  async findReplyAuthors(postId: string, userId?: string) {
    const post = await this.findDiscussionRoot(postId, userId);
    return this.findEligibleContentAuthors({
      threadId: post.threadId,
      ownerId: post.thread.ownerId,
      where: { parentPostId: postId, ...notDeleted },
    });
  }

  private async findEligibleContentAuthors({
    threadId,
    ownerId,
    where,
  }: {
    threadId: string;
    ownerId: string;
    where: Prisma.PostWhereInput;
  }) {
    const rows = await this.prisma.post.findMany({
      where,
      distinct: ['authorId'],
      select: { authorId: true, author: { select: authorSelect } },
    });
    if (rows.length === 0) return [];

    const authorIds = [...new Set(rows.map((row) => row.authorId))];
    const members = await this.prisma.threadMember.findMany({
      where: { threadId, userId: { in: authorIds } },
      select: { userId: true, role: true, playerMarked: true },
    });
    const memberByUserId = new Map(members.map((member) => [member.userId, member]));
    const rank = { OWNER: 0, COLLABORATOR: 1, PARTICIPANT: 2 } as const;

    return rows
      .map((row) => {
        const member = memberByUserId.get(row.authorId);
        const role = row.authorId === ownerId ? 'OWNER' : member?.role;
        if (!role || (role === 'PARTICIPANT' && !member?.playerMarked)) {
          return null;
        }
        return {
          ...row.author,
          role,
          playerMarked: member?.playerMarked ?? false,
        };
      })
      .filter((author): author is NonNullable<typeof author> => author !== null)
      .sort(
        (first, second) =>
          rank[first.role] - rank[second.role] ||
          first.username.localeCompare(second.username, 'zh-CN') ||
          first.id.localeCompare(second.id),
      );
  }

  private async isEligibleDiscussionAuthor(
    threadId: string,
    ownerId: string,
    authorId: string,
  ): Promise<boolean> {
    if (authorId === ownerId) return true;
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: authorId } },
      select: { role: true, playerMarked: true },
    });
    return Boolean(
      member?.playerMarked || member?.role === 'OWNER' || member?.role === 'COLLABORATOR',
    );
  }

  /** 获取单条帖子 + 导航上下文。已软删子贴返回 404 */
  async findById(id: string, userId?: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: {
        id: true,
        threadId: true,
        parentPost: { select: { deletedAt: true } },
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt || postLight.parentPost?.deletedAt) {
      throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    }
    await this.threadAccess.assertAccessible(postLight.threadId, userId);

    const post = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      include: {
        author: { select: authorSelect },
        ...includeDiceRolls(),
        thread: { select: { id: true, title: true } },
        subthread: { select: { id: true, title: true } },
        parentPost: { select: { id: true, floorNumber: true } },
        ...countNonDeletedReplies(),
      },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    return post;
  }
}
