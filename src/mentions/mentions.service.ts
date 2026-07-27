import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** @提及解析服务：从正文提取 @用户名 并创建关联记录 */
@Injectable()
export class MentionsService {
  // 匹配 @用户名 的正则（支持字母、数字、下划线、中文）
  private readonly MENTION_REGEX = /@([a-zA-Z0-9_\u4e00-\u9fff]{2,24})/g;

  constructor(private prisma: PrismaService) {}

  /** 从帖子正文提取 @提及并创建 PostMention 记录 */
  async parseAndCreate(postId: string, content: string, excludeUserId: string) {
    const usernames = this.extractUsernames(content);
    if (usernames.length === 0) return [];

    // 批量查找被 @ 的用户
    const users = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true },
    });

    if (users.length === 0) return [];

    // 排除 @ 了自己的情况
    const mentions = users
      .filter((u) => u.id !== excludeUserId)
      .map((u) => ({
        postId,
        mentionedUserId: u.id,
      }));

    if (mentions.length === 0) return [];

    // 批量创建 PostMention
    await this.prisma.postMention.createMany({
      data: mentions,
      skipDuplicates: true, // 跳过重复的 @(postId, mentionedUserId)
    });

    return users
      .filter((u) => u.id !== excludeUserId)
      .map((u) => ({ userId: u.id, username: u.username }));
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
