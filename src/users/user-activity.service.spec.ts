import { NotFoundException } from '@nestjs/common';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { MentionsService } from '../mentions/mentions.service';
import { MomentBookmarksService } from '../moments/moment-bookmarks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadsService } from '../threads/threads.service';
import { UserActivityService } from './user-activity.service';

describe('UserActivityService', () => {
  const prisma = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    post: { findMany: jest.fn(), count: jest.fn() },
    moment: { count: jest.fn() },
    thread: { count: jest.fn() },
    threadMember: { count: jest.fn() },
  };
  const bookmarks = { findByUserId: jest.fn() };
  const momentBookmarks = { listPublic: jest.fn() };
  const threads = { findByPlayedUser: jest.fn(), findByCreatedUser: jest.fn() };
  const mentions = { findCandidates: jest.fn(), canMentionAllPlayers: jest.fn() };
  let service: UserActivityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserActivityService(
      prisma as unknown as PrismaService,
      bookmarks as unknown as BookmarksService,
      momentBookmarks as unknown as MomentBookmarksService,
      threads as unknown as ThreadsService,
      mentions as unknown as MentionsService,
    );
  });

  it('空搜索词直接返回且不访问数据库', () => {
    expect(service.searchUsers(undefined)).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('用户名搜索排除注销用户并限制十条', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', username: 'Alice', avatar: null }]);

    await expect(service.searchUsers('ali')).resolves.toHaveLength(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { username: { contains: 'ali', mode: 'insensitive' }, deletedAt: null },
      select: { id: true, username: true, avatar: true, level: true },
      take: 10,
      orderBy: { username: 'asc' },
    });
  });

  it('未指定主题时不计算提及候选人', async () => {
    await expect(service.mentionCandidates(undefined, 'user-1')).resolves.toEqual({
      users: [],
      canMentionAllPlayers: false,
    });
    expect(mentions.findCandidates).not.toHaveBeenCalled();
  });

  it('并行返回候选用户和全体玩家提及权限', async () => {
    mentions.findCandidates.mockResolvedValue([{ id: 'user-2' }]);
    mentions.canMentionAllPlayers.mockResolvedValue(true);

    await expect(service.mentionCandidates('thread-1', 'user-1', 'al')).resolves.toEqual({
      users: [{ id: 'user-2' }],
      canMentionAllPlayers: true,
    });
    expect(mentions.findCandidates).toHaveBeenCalledWith('thread-1', 'user-1', 'al');
    expect(mentions.canMentionAllPlayers).toHaveBeenCalledWith('thread-1', 'user-1');
  });

  it('收藏查询完整转发查看者和分页参数', () => {
    bookmarks.findByUserId.mockReturnValue('result');

    expect(service.userBookmarks('target-1', 'viewer-1', 'cursor-1', 12)).toBe('result');
    expect(bookmarks.findByUserId).toHaveBeenCalledWith('target-1', 'viewer-1', 'cursor-1', 12);
  });

  it('参与主题目标用户不存在时返回 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.playedThreads({ targetId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(threads.findByPlayedUser).not.toHaveBeenCalled();
  });

  it('未公开玩家徽章时仅本人可查看参与主题', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', showPlayerBadges: false });

    await expect(
      service.playedThreads({
        targetId: 'target-1',
        viewerId: 'viewer-1',
      }),
    ).rejects.toMatchObject({ message: '该用户未公开参与的帖子' });

    threads.findByPlayedUser.mockResolvedValue('played');
    await expect(
      service.playedThreads({
        targetId: 'target-1',
        viewerId: 'target-1',
        cursor: 'cursor-1',
        limit: 5,
        visibility: 'PRIVATE',
      }),
    ).resolves.toBe('played');
    expect(threads.findByPlayedUser).toHaveBeenCalledWith(
      'target-1',
      'target-1',
      'cursor-1',
      5,
      'PRIVATE',
    );
  });

  it('创建主题查询先验证目标用户存在', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1' });
    threads.findByCreatedUser.mockResolvedValue('created');

    await expect(service.createdThreads('target-1', 'viewer-1', 'cursor-1', 8)).resolves.toBe(
      'created',
    );
    expect(threads.findByCreatedUser).toHaveBeenCalledWith('target-1', 'viewer-1', 'cursor-1', 8);
  });

  it('活动汇总按他人可见范围统计四类创作数据', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'target-1',
      showPlayerBadges: true,
      showRecentReplies: true,
    });
    prisma.moment.count.mockResolvedValue(7);
    prisma.thread.count.mockResolvedValue(3);
    prisma.threadMember.count.mockResolvedValue(4);
    prisma.post.count.mockResolvedValue(28);

    await expect(service.activitySummary('target-1', 'viewer-1')).resolves.toEqual({
      momentCount: 7,
      createdThreadCount: 3,
      playedThreadCount: 4,
      replyCount: 28,
    });
    expect(prisma.moment.count).toHaveBeenCalledWith({
      where: {
        authorId: 'target-1',
        deletedAt: null,
        author: {
          userBlocks: { none: { blockedId: 'viewer-1' } },
          blockedBy: { none: { blockerId: 'viewer-1' } },
        },
      },
    });
    expect(prisma.thread.count).toHaveBeenCalledWith({
      where: {
        ownerId: 'target-1',
        published: true,
        deletedAt: null,
        visibility: 'PUBLIC',
      },
    });
    expect(prisma.threadMember.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'target-1',
        playerMarked: true,
        thread: expect.objectContaining({ visibility: 'PUBLIC' }),
      }),
    });
    expect(prisma.post.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        authorId: 'target-1',
        kind: 'FLOOR',
        thread: expect.objectContaining({ visibility: 'PUBLIC' }),
      }),
    });
  });

  it('他人不可见的参与和回复统计返回 null 且不执行计数', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'target-1',
      showPlayerBadges: false,
      showRecentReplies: false,
    });
    prisma.moment.count.mockResolvedValue(2);
    prisma.thread.count.mockResolvedValue(1);

    await expect(service.activitySummary('target-1', 'viewer-1')).resolves.toEqual({
      momentCount: 2,
      createdThreadCount: 1,
      playedThreadCount: null,
      replyCount: null,
    });
    expect(prisma.threadMember.count).not.toHaveBeenCalled();
    expect(prisma.post.count).not.toHaveBeenCalled();
  });

  it('本人可查看私密主题范围内的活动汇总', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'target-1',
      showPlayerBadges: false,
      showRecentReplies: false,
    });
    prisma.moment.count.mockResolvedValue(2);
    prisma.thread.count.mockResolvedValue(5);
    prisma.threadMember.count.mockResolvedValue(6);
    prisma.post.count.mockResolvedValue(30);

    await service.activitySummary('target-1', 'target-1');

    expect(prisma.thread.count).toHaveBeenCalledWith({
      where: { ownerId: 'target-1', published: true, deletedAt: null },
    });
    expect(prisma.threadMember.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        thread: expect.not.objectContaining({ visibility: expect.anything() }),
      }),
    });
    expect(prisma.post.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        thread: expect.not.objectContaining({ visibility: expect.anything() }),
      }),
    });
  });

  it('未公开最近动态时仅本人可查看', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', showRecentReplies: false });

    await expect(service.recentReplies('target-1', 'viewer-1')).rejects.toMatchObject({
      message: '该用户未公开最近动态',
    });
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });

  it('公开最近回复仅查询公开存活内容并生成含骰点结果的预览', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', showRecentReplies: true });
    prisma.post.findMany.mockResolvedValue([
      {
        id: 'post-1',
        content: '检定结果 [[dice:v1:550e8400-e29b-41d4-a716-446655440000:1d20]]',
        diceRolls: [
          {
            nodeId: '550e8400-e29b-41d4-a716-446655440000',
            notation: '1d20',
            total: 17,
          },
        ],
      },
    ]);

    const result = await service.recentReplies('target-1', 'viewer-1');

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'post-1',
        preview: expect.stringContaining('17'),
      }),
    );
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          authorId: 'target-1',
          kind: 'FLOOR',
          deletedAt: null,
          subthread: { deletedAt: null },
          thread: { published: true, deletedAt: null, visibility: 'PUBLIC' },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    );
  });

  it('本人查看最近回复时允许私密主题', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', showRecentReplies: false });
    prisma.post.findMany.mockResolvedValue([]);

    await expect(service.recentReplies('target-1', 'target-1')).resolves.toEqual([]);
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          thread: { published: true, deletedAt: null },
        }),
      }),
    );
  });
});
