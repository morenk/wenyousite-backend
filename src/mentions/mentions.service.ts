import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** @提及解析服务：从正文提取 @用户名 并创建关联记录 */
@Injectable()
export class MentionsService {
  // 匹配 @用户名 的正则（支持字母、数字、下划线、中文）
  private readonly MENTION_REGEX = /@([a-zA-Z0-9_\u4e00-\u9fff]{2,24})/g;

  constructor(private prisma: PrismaService) {}

  /** 从帖子正文提取 @提及并创建 PostMention 记录
   *  规则：1. 关注对方→可@  2. 同帖内玩家之间可@
   *  3. 玩家可@楼主  4. 楼主可@任何人  5. @自己不记录 */
  async parseAndCreate(postId: string, content: string, excludeUserId: string, threadId?: string) {
    const usernames = this.extractUsernames(content);
    if (usernames.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true },
    });
    if (users.length === 0) return [];

    // @自己的跳过
    let candidates = users.filter((u) => u.id !== excludeUserId);
    if (candidates.length === 0) return [];

    // 有主题帖上下文时，按规则过滤
    if (threadId) {
      candidates = await this.filterByRules(candidates, excludeUserId, threadId);
    }

    if (candidates.length === 0) return [];

    await this.prisma.postMention.createMany({
      data: candidates.map((u) => ({ postId, mentionedUserId: u.id })),
      skipDuplicates: true,
    });

    return candidates.map((u) => ({ userId: u.id, username: u.username }));
  }

  /** 在主题帖上下文，按关注/帖内发言者/楼主规则过滤可 @ 用户 */
  private async filterByRules(
    candidates: { id: string; username: string }[],
    userId: string,
    threadId: string,
  ) {
    const actor = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    const isOwner = actor?.role === 'OWNER';

    const following = await this.prisma.userFollow.findMany({
      where: { followerId: userId, followingId: { in: candidates.map((u) => u.id) } },
      select: { followingId: true },
    });
    const followingIds = new Set(following.map((f) => f.followingId));

    if (!actor && followingIds.size === 0) return [];

    // 帖内非楼主角色：仅可 @ 该帖内发言过的人（分批查询，单批最多 100 个）
    const candidateIds = candidates.map((u) => u.id);
    let posterIds: Set<string> | null = null;
    if (actor && !isOwner) {
      const posters = await this.prisma.post.findMany({
        where: { threadId, deletedAt: null, authorId: { in: candidateIds.slice(0, 100) } },
        select: { authorId: true },
        distinct: ['authorId'],
      });
      posterIds = new Set(posters.map((p) => p.authorId));
    }

    return candidates.filter((u) => {
      if (isOwner) return true;
      if (followingIds.has(u.id)) return true;
      if (posterIds && posterIds.has(u.id)) return true;
      return false;
    });
  }

  /** 从正文提取所有 @用户名 */
  extractUsernames(content: string): string[] {
    const matches = content.match(this.MENTION_REGEX);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(1)))]; // 去重
  }

  /** 获取某个帖子的所有 @提及 */
  async findByPost(postId: string) {
    return this.prisma.postMention.findMany({
      where: { postId },
      include: {
        mentionedUser: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });
  }
}
