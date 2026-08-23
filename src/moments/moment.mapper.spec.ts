import { mapMomentCard, type MomentCardRow } from './moment.mapper';

function makeMoment(content: string): MomentCardRow {
  return {
    id: 'moment-1',
    authorId: 'user-1',
    author: {
      id: 'user-1',
      username: '作者',
      avatar: null,
      level: 1,
      deletedAt: null,
    },
    title: '动态标题',
    content,
    textCoverTheme: 'ROSE',
    coverMedia: null,
    likeCount: 0,
    commentCount: 0,
    bookmarkCount: 0,
    tipTotal: 0n,
    version: 1,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    likes: [],
    bookmarks: [],
    _count: { images: 0 },
  };
}

describe('moment mapper', () => {
  it('正文摘要在截断前降级站内传送门', () => {
    const threadId = 'cmsewdo0h000x7qv6aa77ll1v';
    expect(mapMomentCard(makeMoment(
      `[设定 A](/threads/${threadId}) 和 https://wenyou.site/threads/${threadId}`,
    )).contentExcerpt).toBe('设定 A 和 传送门');
  });

  it('已注销作者的历史动态显式标记为不可互动', () => {
    const moment = makeMoment('历史正文');
    moment.author.deletedAt = new Date('2026-08-23T00:00:00.000Z');

    expect(mapMomentCard(moment).canInteract).toBe(false);
  });
});
