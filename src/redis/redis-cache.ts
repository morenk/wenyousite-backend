import KeyvRedis, { Keyv } from '@keyv/redis';
import { RedisConnectionOptions, redisConnectionUrl } from './redis-connection';
import { REDIS_COMMAND_TIMEOUT_MS } from './redis-client-policy';

class DisposableKeyvRedis extends KeyvRedis<unknown> {
  private stopped = false;

  override async getClient() {
    if (this.stopped) throw new Error('Redis cache closed');
    return super.getClient();
  }

  /** 关停不发送可能在故障连接上等待的 QUIT/close 排空命令。 */
  override async disconnect(force?: boolean): Promise<void> {
    // Keyv 的正常关停不传 force；连接失败内部 disconnect(true) 仍允许下一次请求恢复。
    if (force === undefined) this.stopped = true;
    await super.disconnect(true);
  }
}

export function createCacheStore(connection: RedisConnectionOptions): Keyv {
  const adapter = new DisposableKeyvRedis(
    {
      url: redisConnectionUrl(connection),
      disableOfflineQueue: true,
      commandOptions: { timeout: REDIS_COMMAND_TIMEOUT_MS },
      socket: {
        connectTimeout: REDIS_COMMAND_TIMEOUT_MS,
        socketTimeout: REDIS_COMMAND_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    },
    { throwOnConnectError: true, throwOnErrors: true },
  );
  // 与 createKeyv 的既有键前缀一致；下次缓存请求可重新连接，不积压离线写入。
  const keyv = new Keyv(adapter, { useKeyPrefix: false });
  keyv.namespace = undefined;
  keyv.throwOnErrors = true;
  keyv.on('error', () => undefined);
  return keyv;
}
