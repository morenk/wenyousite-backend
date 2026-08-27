import { ConfigService } from '@nestjs/config';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
}

/** 为 ioredis、BullMQ 与 Keyv 生成同一份连接参数，避免认证配置漂移。 */
export function redisConnectionOptions(config: ConfigService): RedisConnectionOptions {
  return {
    host: config.get<string>('redis.host') ?? '127.0.0.1',
    port: config.get<number>('redis.port') ?? 6379,
    db: config.get<number>('redis.db') ?? 0,
    username: config.get<string>('redis.username') || undefined,
    password: config.get<string>('redis.password') || undefined,
  };
}

export function redisConnectionUrl(options: RedisConnectionOptions): string {
  const url = new URL('redis://127.0.0.1');
  url.hostname = options.host;
  url.port = String(options.port);
  url.pathname = `/${options.db}`;
  if (options.username) url.username = options.username;
  if (options.password) url.password = options.password;
  return url.toString();
}
