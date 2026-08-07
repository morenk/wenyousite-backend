import { Cache } from 'cache-manager';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    stores: undefined as unknown,
  };
  let service: CacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.stores = undefined;
    service = new CacheService(cache as unknown as Cache);
    jest.spyOn(
      (service as unknown as {
        logger: {
          warn: (...args: unknown[]) => void;
          debug: (...args: unknown[]) => void;
        };
      }).logger,
      'debug',
    ).mockImplementation(() => undefined);
    jest.spyOn(
      (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('构建统一命名空间的缓存键', () => {
    expect(service.buildKey('thread', 'thread-1')).toBe('cache:thread:thread-1');
  });

  it('透传缓存读写删除及 TTL', async () => {
    cache.get.mockResolvedValue({ id: 'thread-1' });
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(undefined);

    await expect(service.get('cache:thread:thread-1')).resolves.toEqual({ id: 'thread-1' });
    await service.set('cache:thread:thread-1', { id: 'thread-1' }, 5_000);
    await service.del('cache:thread:thread-1');

    expect(cache.set).toHaveBeenCalledWith(
      'cache:thread:thread-1',
      { id: 'thread-1' },
      5_000,
    );
    expect(cache.del).toHaveBeenCalledWith('cache:thread:thread-1');
  });

  it('缓存故障降级而不影响业务请求', async () => {
    cache.get.mockRejectedValue(new Error('redis read failed'));
    cache.set.mockRejectedValue(new Error('redis write failed'));
    cache.del.mockRejectedValue(new Error('redis delete failed'));

    await expect(service.get('key')).resolves.toBeUndefined();
    await expect(service.set('key', 'value')).resolves.toBeUndefined();
    await expect(service.del('key')).resolves.toBeUndefined();
  });

  it('从所有 store 汇总匹配键并并行删除', async () => {
    cache.stores = [
      { keys: jest.fn().mockResolvedValue(['key-1', 'key-2']) },
      { keys: jest.fn().mockResolvedValue(['key-3']) },
      {},
    ];
    cache.del.mockResolvedValue(undefined);

    await service.delByPattern('cache:threads:list:*');

    expect(cache.del.mock.calls.map((call) => call[0])).toEqual(['key-1', 'key-2', 'key-3']);
  });

  it('底层 store 不支持 keys 或查询失败时安全降级', async () => {
    await expect(service.delByPattern('pattern')).resolves.toBeUndefined();
    cache.stores = [{ keys: jest.fn().mockRejectedValue(new Error('scan failed')) }];
    await expect(service.delByPattern('pattern')).resolves.toBeUndefined();
    expect(cache.del).not.toHaveBeenCalled();
  });
});
