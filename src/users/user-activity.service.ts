import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { ThreadsService } from '../threads/threads.service';
import { MentionsService } from '../mentions/mentions.service';
import { buildPostPreview } from '../common/post-preview';

/** 用户公开活动查询：集中处理隐私开关、可见性和跨模块读模型编排。 */
@Injectable()
export class UserActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookmarks: BookmarksService,
    private readonly threads: ThreadsService,
    private readonly mentions: MentionsService,
  ) {}

  searchUsers(query: string | undefined) {
    if (!query) return [];
    return this.prisma.user.findMany({
      where: { username: { contains: query, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, username: true, avatar: true, level: true },
      take: 10,
      orderBy: { username: 'asc' },
    });
  }

  async mentionCandidates(threadId: string | undefined, userId: string, query?: string) {
    if (!threadId) return { users: [], canMentionAllPlayers: false };
    const [users, canMentionAllPlayers] = await Promise.all([
      this.mentions.findCandidates(threadId, userId, query),
      this.mentions.canMentionAllPlayers(threadId, userId),
    ]);
    return { users, canMentionAllPlayers };
  }

  userBookmarks(targetId: string, viewerId?: string, cursor?: string, limit?: number) {
    return this.bookmarks.findByUserId(targetId, viewerId, cursor, limit);
  }

  async playedThreads(input: {
    targetId: string;
    viewerId?: string;
    cursor?: string;
    limit?: number;
    visibility?: 'PUBLIC' | 'PRIVATE';
  }) {
    const target = await this.prisma.user.findUnique({
      where: { id: input.targetId, deletedAt: null },
      select: { id: true, showPlayerBadges: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (!target.showPlayerBadges && target.id !== input.viewerId) {
      throw new NotFoundException('该用户未公开参与的帖子');
    }
    return this.threads.findByPlayedUser(
      input.targetId,
      input.viewerId,
      input.cursor,
      input.limit,
      input.visibility,
    );
  }

  async createdThreads(targetId: string, viewerId?: string, cursor?: string, limit?: number) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    return this.threads.findByCreatedUser(targetId, viewerId, cursor, limit);
  }

  async recentReplies(targetId: string, viewerId?: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId, deletedAt: null },
      select: { id: true, showRecentReplies: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (!target.showRecentReplies && target.id !== viewerId) {
      throw new NotFoundException('该用户未公开最近动态');
    }

    const isSelf = viewerId === targetId;
    const replies = await this.prisma.post.findMany({
      where: {
        authorId: targetId,
        deletedAt: null,
        subthread: { deletedAt: null },
        thread: {
          published: true,
          deletedAt: null,
          ...(isSelf ? {} : { visibility: 'PUBLIC' as const }),
        },
      },
      select: {
        id: true,
        createdAt: true,
        floorNumber: true,
        parentPostId: true,
        content: true,
        threadId: true,
        thread: { select: { title: true } },
        subthreadId: true,
        subthread: { select: { title: true } },
        diceRolls: {
          orderBy: { createdAt: 'asc' as const },
          select: { nodeId: true, notation: true, total: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return replies.map((reply) => ({
      ...reply,
      preview: buildPostPreview(reply.content, reply.diceRolls),
    }));
  }
}
