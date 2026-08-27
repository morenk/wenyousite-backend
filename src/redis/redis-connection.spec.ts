import { ConfigService } from '@nestjs/config';
import { redisConnectionOptions, redisConnectionUrl } from './redis-connection';

describe('Redis connection configuration', () => {
  it('在所有 Redis 消费者间保留 ACL 凭据并正确编码 URL', () => {
    const config = new ConfigService({
      redis: {
        host: '127.0.0.1',
        port: 6380,
        db: 3,
        username: 'wenyou app',
        password: 'p@ss:/?#word',
      },
    });

    const options = redisConnectionOptions(config);
    expect(options).toEqual({
      host: '127.0.0.1',
      port: 6380,
      db: 3,
      username: 'wenyou app',
      password: 'p@ss:/?#word',
    });
    expect(redisConnectionUrl(options)).toBe(
      'redis://wenyou%20app:p%40ss%3A%2F%3F%23word@127.0.0.1:6380/3',
    );
  });

  it('未配置认证时保持本地开发兼容', () => {
    const options = redisConnectionOptions(new ConfigService({ redis: {} }));
    expect(options).toEqual({
      host: '127.0.0.1',
      port: 6379,
      db: 0,
      username: undefined,
      password: undefined,
    });
  });
});
