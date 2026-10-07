import KeyvRedis from '@keyv/redis';
import { createCacheStore } from './redis-cache';
import { REDIS_COMMAND_TIMEOUT_MS } from './redis-client-policy';

describe('Redis cache connection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('保留既有无 namespace 键语义，并使用底层有界命令而非外层 Promise.race', () => {
    const store = createCacheStore({ host: 'example.invalid', port: 12345, db: 3 });
    const adapter = store.store as KeyvRedis<unknown>;
    expect(store.namespace).toBeUndefined();
    expect(store.useKeyPrefix).toBe(false);
    expect(store.throwOnErrors).toBe(true);
    expect('options' in adapter.client ? adapter.client.options : undefined).toEqual(
      expect.objectContaining({
        url: 'redis://example.invalid:12345/3',
        disableOfflineQueue: true,
        commandOptions: { timeout: REDIS_COMMAND_TIMEOUT_MS },
        socket: expect.objectContaining({
          reconnectStrategy: false,
          socketTimeout: REDIS_COMMAND_TIMEOUT_MS,
        }),
      }),
    );
  });

  it('普通连接故障的内部断开仍允许后续请求重新连接', async () => {
    jest.spyOn(KeyvRedis.prototype, 'disconnect').mockResolvedValue(undefined);
    const getClient = jest
      .spyOn(KeyvRedis.prototype, 'getClient')
      .mockRejectedValue(new Error('recoverable-fixture'));
    const store = createCacheStore({ host: 'example.invalid', port: 12345, db: 0 });
    const adapter = store.store as KeyvRedis<unknown>;
    await adapter.disconnect(true);
    await expect(adapter.getClient()).rejects.toThrow('recoverable-fixture');
    expect(getClient).toHaveBeenCalledTimes(1);
  });

  it('CacheManager disconnect 路径强制断开，不等待 Redis 排空', async () => {
    const disconnect = jest.spyOn(KeyvRedis.prototype, 'disconnect').mockResolvedValue(undefined);
    const store = createCacheStore({ host: 'example.invalid', port: 12345, db: 0 });
    await store.disconnect();
    expect(disconnect).toHaveBeenCalledWith(true);
    await expect(store.get('after-close')).rejects.toThrow('Redis cache closed');
  });
});
