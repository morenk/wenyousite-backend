import {
  DEACTIVATED_USER_NAME,
  sanitizePublicUserSummaries,
} from './user-summary';

describe('sanitizePublicUserSummaries', () => {
  it('应递归屏蔽已注销的帖子作者并移除注销时间', () => {
    const deletedAt = new Date('2026-08-06T00:00:00Z');
    const result = sanitizePublicUserSummaries({
      id: 'post-1',
      author: {
        id: 'user-1',
        username: 'morenk_deleted_178601646',
        avatar: 'https://example.com/old-avatar.webp',
        deletedAt,
      },
    });

    expect(result).toEqual({
      id: 'post-1',
      author: {
        id: 'user-1',
        username: DEACTIVATED_USER_NAME,
        avatar: null,
      },
    });
  });

  it('未注销用户保持原资料且不对外暴露 deletedAt', () => {
    const result = sanitizePublicUserSummaries({
      owner: {
        id: 'user-1',
        username: 'morenk',
        avatar: 'https://example.com/avatar.webp',
        deletedAt: null,
      },
    });

    expect(result).toEqual({
      owner: {
        id: 'user-1',
        username: 'morenk',
        avatar: 'https://example.com/avatar.webp',
      },
    });
  });

  it('通知操作者已注销时保留 deletedAt 供前端阻止跳转', () => {
    const deletedAt = new Date('2026-08-06T00:00:00Z');
    const result = sanitizePublicUserSummaries({
      fromUser: {
        id: 'user-1',
        username: 'deleted_internal',
        avatar: 'https://example.com/avatar.webp',
        deletedAt,
      },
    });

    expect(result).toEqual({
      fromUser: {
        id: 'user-1',
        username: DEACTIVATED_USER_NAME,
        avatar: null,
        deletedAt,
      },
    });
  });

  it('不修改包含邮箱的本人私有资料', () => {
    const profile = {
      id: 'user-1',
      email: 'user@example.com',
      username: 'morenk',
      avatar: null,
      deletedAt: null,
    };

    expect(sanitizePublicUserSummaries(profile)).toEqual(profile);
  });
});
