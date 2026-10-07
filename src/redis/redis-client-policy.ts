import Redis, { RedisOptions } from 'ioredis';
import type { RedisConnectionOptions } from './redis-connection';

/** 每条已提交命令的预算；连接重试不延长 HTTP/Outbox 对该命令的等待。 */
export const REDIS_COMMAND_TIMEOUT_MS = 1000;

export function redisRequestOptions(connection: RedisConnectionOptions): RedisOptions {
  return {
    ...connection,
    connectTimeout: REDIS_COMMAND_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    socketTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    retryStrategy: (times) => Math.min(times * 100, 1000),
  };
}

export function createRequestRedis(connection: RedisConnectionOptions): Redis {
  const client = new Redis(redisRequestOptions(connection));
  // 调用方负责失败策略；不让 ioredis 默认处理器输出连接信息或原始错误。
  client.on('error', () => undefined);
  return client;
}
