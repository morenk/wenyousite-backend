import { CacheInvalidationListener } from './cache-invalidation.listener';
import { CacheService } from './cache.service';

describe('CacheInvalidationListener', () => {
  const cache = {
    buildKey: jest.fn((...parts: string[]) => `cache:${parts.join(':')}`),
    del: jest.fn(),
    delByPattern: jest.fn(),
  };
  let listener: CacheInvalidationListener;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.del.mockResolvedValue(undefined);
    cache.delByPattern.mockResolvedValue(undefined);
    listener = new CacheInvalidationListener(cache as unknown as CacheService);
    jest.spyOn(
      (listener as unknown as { logger: { debug: (...args: unknown[]) => void } }).logger,
      'debug',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('主题变化同时失效详情和全部列表排序', async () => {
    await listener.handleThreadChange({ threadId: 'thread-1' });

    expect(cache.del).toHaveBeenCalledWith('cache:thread:thread-1');
    expect(cache.delByPattern).toHaveBeenCalledWith('cache:threads:list:*');
  });

  it('新楼中楼回复同时失效主题、子贴、父楼回复和列表', async () => {
    await listener.handlePostCreated({
      threadId: 'thread-1',
      subthreadId: 'subthread-1',
      parentPostId: 'parent-1',
    });

    expect(cache.del.mock.calls.map((call) => call[0])).toEqual([
      'cache:thread:thread-1',
      'cache:subthread:posts:subthread-1',
      'cache:post:replies:parent-1',
    ]);
    expect(cache.delByPattern).toHaveBeenCalledWith('cache:threads:list:*');
  });

  it('普通楼层不误删楼中楼父级缓存', async () => {
    await listener.handlePostCreated({
      threadId: 'thread-1',
      subthreadId: 'subthread-1',
    });

    expect(cache.del).not.toHaveBeenCalledWith(expect.stringContaining('replies'));
  });

  it('修改回复时失效帖子、父楼回复和主题详情', async () => {
    await listener.handlePostUpdated({
      threadId: 'thread-1',
      postId: 'post-1',
      parentPostId: 'parent-1',
    });

    expect(cache.del.mock.calls.map((call) => call[0])).toEqual([
      'cache:post:post-1',
      'cache:post:replies:parent-1',
      'cache:thread:thread-1',
    ]);
  });

  it('删除帖子额外失效主题列表', async () => {
    await listener.handlePostDeleted({ threadId: 'thread-1', postId: 'post-1' });

    expect(cache.del).toHaveBeenCalledWith('cache:post:post-1');
    expect(cache.del).toHaveBeenCalledWith('cache:thread:thread-1');
    expect(cache.delByPattern).toHaveBeenCalledWith('cache:threads:list:*');
  });

  it('用户资料变化清除用户、自身视图及所有嵌入用户摘要的主题缓存', async () => {
    await listener.handleUserChange({ userId: 'user-1' });

    expect(cache.del.mock.calls.map((call) => call[0])).toEqual([
      'cache:user:user-1',
      'cache:user:me:user-1',
    ]);
    expect(cache.delByPattern.mock.calls.map((call) => call[0])).toEqual([
      'cache:thread:*',
      'cache:threads:list:*',
    ]);
  });

  it('点赞、标签和子贴事件只失效各自依赖的缓存', async () => {
    await listener.handleThreadLikeChange({ threadId: 'thread-1' });
    await listener.handleTagCreated();
    await listener.handleSubthreadChange({ threadId: 'thread-1', subthreadId: 'subthread-1' });

    expect(cache.del).toHaveBeenCalledWith('cache:thread:thread-1');
    expect(cache.del).toHaveBeenCalledWith('cache:tags:list');
    expect(cache.del).toHaveBeenCalledWith('cache:subthread:subthread-1');
    expect(cache.delByPattern).toHaveBeenCalledWith('cache:threads:list:*');
  });
});
