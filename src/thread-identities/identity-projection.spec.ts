import { IdentityProjectionService } from './identity-projection.service';
import { PrismaService } from '../prisma/prisma.service';
const snapshot = {
  id: 'identity',
  nickname: '旧角色',
  avatar: 'https://legacy/avatar',
  avatarMediaId: null,
};
describe('帖内身份读取投影', () => {
  function setup(enabled = true) {
    const db = {
      post: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'post',
            authorIdentitySnapshot: snapshot,
            authorId: 'u',
            mentionIdentitySnapshots: [{ userId: 'u', label: '旧角色', identityId: 'identity' }],
            content: '[@旧角色](/users/u)',
            author: { deletedAt: null },
            identityAvatarMedia: null,
            thread: { rpIdentityEnabled: enabled },
          },
        ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u', username: '真实账号' }]) },
      thread: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'u', rpIdentityEnabled: enabled }),
      },
      threadIdentity: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'identity',
            userId: 'u',
            nickname: '新角色',
            avatarMediaId: null,
            avatarMedia: null,
          },
        ]),
      },
      threadMember: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { db, service: new IdentityProjectionService(db as unknown as PrismaService) };
  }
  it('题头保持账号，不覆盖嵌套旧楼层作者；旧头像无媒体ID可保留合法历史来源', async () => {
    const { service, db } = setup();
    const value = {
      id: 'thread',
      owner: { id: 'u', username: '真实账号', avatar: null },
      bodyPost: {
        id: 'post',
        content: '正文',
        author: { id: 'u', username: '真实账号', avatar: null },
      },
    };
    const result = await service.project(value, { currentUsers: true, threadId: 'thread' });
    expect(db.threadIdentity.findMany).not.toHaveBeenCalled();
    expect(result.owner).toMatchObject({ rpIdentity: null });
    expect(result.bodyPost.author).toMatchObject({
      username: '真实账号',
      rpIdentity: { nickname: '旧角色', avatar: 'https://legacy/avatar' },
    });
  });
  it('关闭隐藏身份与提及，重新开启恢复各自快照；原始正文不变化', async () => {
    for (const enabled of [false, true]) {
      const { service } = setup(enabled);
      const result = await service.project({
        id: 'post',
        author: { id: 'u', username: '真实账号' },
        content: '[@旧角色](/users/u)',
      });
      expect(result).toMatchObject({
        content: '[@旧角色](/users/u)',
        author: { rpIdentity: enabled ? { nickname: '旧角色' } : null },
        mentionIdentities: [
          { userId: 'u', label: '旧角色', displayName: enabled ? '旧角色' : '真实账号' },
        ],
      });
    }
  });
  it('治理移除媒体不恢复快照URL或display', async () => {
    const { service, db } = setup();
    db.post.findMany.mockResolvedValue([
      {
        id: 'post',
        authorIdentitySnapshot: { ...snapshot, avatarMediaId: 'deleted-media' },
        mentionIdentitySnapshots: [],
        content: '',
        author: { deletedAt: null },
        identityAvatarMedia: null,
        thread: { rpIdentityEnabled: true },
      },
    ]);
    const result = await service.project({ id: 'post', author: { id: 'u', username: '真实账号' } });
    expect(result.author).toMatchObject({ rpIdentity: { avatar: null, avatarDisplay: null } });
  });
  it('点赞/打赏来源不能借用被点赞楼层作者的RP身份，发言通知才使用作者快照', async () => {
    const { service } = setup();
    for (const type of ['like','tip','mention']) {
      const result = await service.project({id:'notification',type,postId:'post',fromUser:{id:'u'},payload:{} as Record<string,unknown>});
      expect(result.payload.rpIdentity).toEqual(type === 'mention' ? expect.objectContaining({id:'identity'}) : null);
    }
    const other = await service.project({id:'notification',type:'mention',postId:'post',fromUser:{id:'other'},payload:{} as Record<string,unknown>});
    expect(other.payload.rpIdentity).toBeNull();
  });
  it('离开帖子上下文不改全站用户资料', async () => {
    const { service, db } = setup();
    expect(await service.project({ id: 'u', username: '账号', avatar: null })).toEqual({
      id: 'u',
      username: '账号',
      avatar: null,
    });
    expect(db.threadIdentity.findMany).not.toHaveBeenCalled();
  });
});
