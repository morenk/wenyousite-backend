import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BlockFilterService, BlockSets } from '../access/block-filter.service';
import { publicUserSummarySelect } from '../common/user-summary';

export const ALL_PLAYERS_MENTION = '全体玩家';
export const MAX_DIRECT_MENTIONS = 10;

type MentionSource = 'DIRECT' | 'ALL_PLAYERS';

export interface MentionedUser {
  userId: string;
  username: string;
  source: MentionSource;
}
export interface MentionCandidate {
  id: string;
  username: string;
  avatar: string | null;
  relation: 'FOLLOWING' | 'PLAYER';
}

interface MentionTokens {
  usernames: string[];
  userIds: string[];
  allPlayers: boolean;
}

/** @提及解析与候选范围服务。权限规则必须在此处集中校验，不能只依赖编辑器。 */
@Injectable()
export class MentionsService {
  private readonly mentionRegex = /(?:^|[^a-zA-Z0-9_\u4e00-\u9fff])@([a-zA-Z0-9_\u4e00-\u9fff]{1,24})/gu;
  private readonly canonicalMentionRegex = /\[@[^\]]{1,32}\]\(\/users\/([a-zA-Z0-9_-]+)\)/g;

  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
    private blockFilter: BlockFilterService,
  ) {}

  /** 创建时同步提及快照；返回本次新增的收件人，供通知队列使用。 */
  async parseAndCreate(
    postId: string,
    content: string,
    excludeUserId: string,
    threadId?: string,
    previousContent?: string,
  ) {
    return this.syncMentions(postId, content, excludeUserId, threadId, previousContent);
  }

  async syncMentions(
    postId: string,
    content: string,
    excludeUserId: string,
    threadId?: string,
    previousContent?: string,
  ): Promise<MentionedUser[]> {
    const tokens = this.extractMentionTokens(content);
    if (!threadId) return [];
    if (tokens.usernames.length === 0 && tokens.userIds.length === 0 && !tokens.allPlayers) {
      await this.prisma.postMention.deleteMany({ where: { postId } });
      return [];
    }

    await this.threadAccess.assertAccessible(threadId, excludeUserId);
    const blockSets = await this.blockFilter.loadBlockSets(excludeUserId);

    const existing = (await this.prisma.postMention.findMany({
      where: { postId },
      include: { mentionedUser: { select: publicUserSummarySelect } },
    })) ?? [];

    const directUsers = await this.findDirectUsers(tokens);
    const directCandidates = await this.filterDirectCandidates(
      directUsers,
      excludeUserId,
      threadId,
      blockSets,
    );
    const desired = new Map<string, { userId: string; source: MentionSource; username: string }>();

    for (const user of directCandidates.slice(0, MAX_DIRECT_MENTIONS)) {
      desired.set(`${user.id}:DIRECT`, { userId: user.id, source: 'DIRECT', username: user.username });
    }

    if (tokens.allPlayers && await this.canMentionAllPlayers(threadId, excludeUserId)) {
      const previousHadGroup = previousContent
        ? this.extractMentionTokens(previousContent).allPlayers
        : false;
      const existingGroup = existing.filter((mention) => mention.source === 'ALL_PLAYERS');
      const groupUsers = previousHadGroup && existingGroup.length > 0
        ? existingGroup.map((mention) => mention.mentionedUser)
        : await this.findMarkedPlayers(threadId, blockSets);

      for (const user of groupUsers) {
        if (user.id === excludeUserId) continue;
        desired.set(`${user.id}:ALL_PLAYERS`, {
          userId: user.id,
          source: 'ALL_PLAYERS',
          username: user.username,
        });
      }
    }

    const existingByKey = new Map(
      existing.map((mention) => [`${mention.mentionedUserId}:${mention.source}`, mention]),
    );
    const desiredKeys = new Set(desired.keys());
    const staleIds = existing
      .filter((mention) => !desiredKeys.has(`${mention.mentionedUserId}:${mention.source}`))
      .map((mention) => mention.id);
    if (staleIds.length > 0) {
      await this.prisma.postMention.deleteMany({ where: { id: { in: staleIds } } });
    }

    const added = [...desired.values()].filter(
      (mention) => !existingByKey.has(`${mention.userId}:${mention.source}`),
    );
    if (added.length > 0) {
      await this.prisma.postMention.createMany({
        data: added.map((mention) => ({
          postId,
          mentionedUserId: mention.userId,
          source: mention.source,
        })),
        skipDuplicates: true,
      });
    }

    // 同一用户同时被单人和全体命中时只发一条通知；记录层仍保留两个来源。
    const uniqueUsers = new Map<string, MentionedUser>();
    for (const mention of added) {
      if (!uniqueUsers.has(mention.userId)) {
        uniqueUsers.set(mention.userId, mention);
      }
    }
    return [...uniqueUsers.values()];
  }

  /** 编辑器候选：关注列表与帖内 playerMarked=true 的用户并集。 */
  async findCandidates(threadId: string, userId: string, query?: string) {
    await this.threadAccess.assertAccessible(threadId, userId);
    const blockSets = await this.blockFilter.loadBlockSets(userId);
    const normalizedQuery = query?.trim();
    const userFilter = normalizedQuery
      ? { username: { contains: normalizedQuery, mode: 'insensitive' as const } }
      : {};
    const [following, players] = await Promise.all([
      this.prisma.userFollow.findMany({
        where: { followerId: userId, following: { deletedAt: null, ...userFilter } },
        select: { following: { select: { id: true, username: true, avatar: true } } },
      }),
      this.prisma.threadMember.findMany({
        where: { threadId, playerMarked: true, user: { deletedAt: null, ...userFilter } },
        select: { user: { select: { id: true, username: true, avatar: true } } },
      }),
    ]);

    const candidates = new Map<string, MentionCandidate>();
    for (const item of following) {
      candidates.set(item.following.id, { ...item.following, relation: 'FOLLOWING' });
    }
    for (const item of players) {
      const previous = candidates.get(item.user.id);
      candidates.set(item.user.id, {
        ...item.user,
        relation: previous?.relation ?? 'PLAYER',
      });
    }
    const visibleIds = new Set(
      this.blockFilter.filterRecipients([...candidates.keys()], blockSets),
    );
    return [...candidates.values()]
      .filter((candidate) => candidate.id !== userId)
      .filter((candidate) => visibleIds.has(candidate.id))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 20);
  }

  async canMentionAllPlayers(threadId: string, userId: string) {
    const actor = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
      select: { role: true },
    });
    return actor?.role === 'OWNER' || actor?.role === 'COLLABORATOR';
  }

  private async findDirectUsers(tokens: MentionTokens) {
    const or: Array<
      | { id: { in: string[] } }
      | { username: { in: string[] } }
    > = [];
    if (tokens.userIds.length > 0) or.push({ id: { in: tokens.userIds } });
    if (tokens.usernames.length > 0) or.push({ username: { in: tokens.usernames } });
    if (or.length === 0) return [];
    return this.prisma.user.findMany({
      where: { OR: or, deletedAt: null },
      select: { id: true, username: true, avatar: true },
    });
  }

  private async filterDirectCandidates(
    candidates: { id: string; username: string; avatar?: string | null }[],
    userId: string,
    threadId: string,
    blockSets: BlockSets,
  ) {
    if (candidates.length === 0) return [];
    const ids = candidates.filter((candidate) => candidate.id !== userId).map((candidate) => candidate.id);
    if (ids.length === 0) return [];
    const [followingResult, markedMembersResult] = await Promise.all([
      this.prisma.userFollow.findMany({
        where: { followerId: userId, followingId: { in: ids } },
        select: { followingId: true },
      }),
      this.prisma.threadMember.findMany({
        where: { threadId, playerMarked: true, userId: { in: ids } },
        select: { userId: true },
      }),
    ]);
    const following = followingResult ?? [];
    const markedMembers = markedMembersResult ?? [];
    const allowedIds = new Set([
      ...following.map((item) => item.followingId),
      ...markedMembers.map((item) => item.userId),
    ]);
    const visibleIds = new Set(this.blockFilter.filterRecipients([...allowedIds], blockSets));
    return candidates.filter((candidate) => visibleIds.has(candidate.id));
  }

  private async findMarkedPlayers(threadId: string, blockSets: BlockSets) {
    const members = await this.prisma.threadMember.findMany({
      where: { threadId, playerMarked: true, user: { deletedAt: null } },
      select: { user: { select: { id: true, username: true, avatar: true } } },
    });
    const visibleIds = new Set(
      this.blockFilter.filterRecipients(members.map((member) => member.user.id), blockSets),
    );
    return members.map((member) => member.user).filter((user) => visibleIds.has(user.id));
  }

  private extractMentionTokens(content: string): MentionTokens {
    const withoutCode = this.stripMarkdownCode(content);
    const userIds: string[] = [];
    const withoutCanonical = withoutCode.replace(
      this.canonicalMentionRegex,
      (marker: string, userId: string, offset: number) => {
        if (!this.isEscaped(withoutCode, offset)) userIds.push(userId);
        // 转义的稳定链接也必须从后续历史 @用户名解析中遮蔽。
        return ' '.repeat(marker.length);
      },
    );
    const mentionNames = [...withoutCanonical.matchAll(this.mentionRegex)]
      .filter((match) => {
        const atOffset = match[0].indexOf('@');
        return match.index !== undefined && !this.isEscaped(withoutCanonical, match.index + atOffset);
      })
      .map((match) => match[1])
      .filter((username): username is string => typeof username === 'string');
    const allPlayers = mentionNames.includes(ALL_PLAYERS_MENTION);
    const usernames = mentionNames.filter((username) => username !== ALL_PLAYERS_MENTION);
    return {
      usernames: [...new Set(usernames)],
      userIds: [...new Set(userIds)],
      allPlayers,
    };
  }

  private isEscaped(content: string, index: number): boolean {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor--) slashes++;
    return slashes % 2 === 1;
  }

  /** 防御性移除历史围栏和允许的行内代码，避免代码示例触发真实通知。 */
  private stripMarkdownCode(content: string): string {
    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    let fence: { marker: '`' | '~'; length: number } | null = null;

    return lines.map((line) => {
      if (fence) {
        const closingToken = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/)?.[1];
        if (
          closingToken?.[0] === fence.marker
          && closingToken.length >= fence.length
        ) {
          fence = null;
        }
        return '';
      }

      const openingToken = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
      if (openingToken) {
        fence = {
          marker: openingToken[0] as '`' | '~',
          length: openingToken.length,
        };
        return '';
      }

      return this.stripInlineCode(line);
    }).join('\n');
  }

  /** CommonMark 行内代码的关闭反引号必须与开启 run 等长。 */
  private stripInlineCode(line: string): string {
    let result = '';
    let index = 0;

    while (index < line.length) {
      if (line[index] !== '`') {
        result += line[index];
        index += 1;
        continue;
      }

      const openingStart = index;
      while (line[index] === '`') index += 1;
      const openingLength = index - openingStart;
      let cursor = index;
      let closingEnd = -1;

      while (cursor < line.length) {
        const nextRun = line.indexOf('`', cursor);
        if (nextRun === -1) break;
        let runEnd = nextRun;
        while (line[runEnd] === '`') runEnd += 1;
        if (runEnd - nextRun === openingLength) {
          closingEnd = runEnd;
          break;
        }
        cursor = runEnd;
      }

      if (closingEnd === -1) {
        result += '`'.repeat(openingLength);
        continue;
      }

      result += ' ';
      index = closingEnd;
    }

    return result;
  }

  extractUsernames(content: string): string[] {
    return this.extractMentionTokens(content).usernames;
  }

  async findByPost(postId: string) {
    return this.prisma.postMention.findMany({
      where: { postId },
      include: {
        mentionedUser: { select: publicUserSummarySelect },
      },
    });
  }
}
