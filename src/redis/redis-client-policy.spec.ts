import Redis from 'ioredis';
import {
  createRequestRedis,
  redisRequestOptions,
  REDIS_COMMAND_TIMEOUT_MS,
} from './redis-client-policy';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => ({ on: jest.fn() })) }));

describe('Redis request boundary', () => {
  it('请求连接保留认证并拒绝离线排队与未确认命令重放', () => {
    const connection = {
      host: 'example.invalid',
      port: 12345,
      db: 4,
      username: 'fixture',
      password: 'fixture',
    };
    createRequestRedis(connection);
    expect(Redis).toHaveBeenCalledWith(
      expect.objectContaining({
        ...connection,
        commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        connectTimeout: REDIS_COMMAND_TIMEOUT_MS,
        socketTimeout: REDIS_COMMAND_TIMEOUT_MS,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
      }),
    );
    const options = redisRequestOptions(connection) as { retryStrategy: (times: number) => number };
    expect(options.retryStrategy(1)).toBeGreaterThan(0);
    expect(options.retryStrategy(1000)).toBe(1000);
  });
});
