import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Redis 底层服务：计数器(Hash)、有序集合(ZSET)、键操作 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // ── Hash 计数器 ──

  /** 自增 Hash 字段 */
  async hincrby(key: string, field: string, increment: number) {
    return this.redis.hincrby(key, field, increment);
  }

  /** 获取 Hash 全部字段 */
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }

  /** 获取 Hash 单个字段 */
  async hget(key: string, field: string) {
    return this.redis.hget(key, field);
  }

  /** 设置 Hash 字段 */
  async hset(key: string, field: string, value: string | number) {
    return this.redis.hset(key, field, String(value));
  }

  /** 删除 Hash 字段 */
  async hdel(key: string, ...fields: string[]) {
    if (fields.length === 0) return 0;
    return this.redis.hdel(key, ...fields);
  }

  /** 删除整个 Hash 键 */
  async hdelAll(key: string) {
    return this.redis.del(key);
  }

  // ── 有序集合 ZSET（用于帖子列表排序） ──

  /** 添加/更新有序集合成员 */
  async zadd(key: string, score: number, member: string) {
    return this.redis.zadd(key, score, member);
  }

  /** 批量添加 */
  async zaddMulti(key: string, ...scoreMembers: (number | string)[]) {
    return this.redis.zadd(key, ...scoreMembers);
  }

  /** 从有序集合移除成员 */
  async zrem(key: string, ...members: string[]) {
    if (members.length === 0) return 0;
    return this.redis.zrem(key, ...members);
  }

  /** 倒序分页（高到低） */
  async zrevrange(key: string, start: number, stop: number) {
    return this.redis.zrevrange(key, start, stop);
  }

  /** 正序分页 */
  async zrange(key: string, start: number, stop: number) {
    return this.redis.zrange(key, start, stop);
  }

  /** 获取成员分数 */
  async zscore(key: string, member: string) {
    return this.redis.zscore(key, member);
  }

  /** 获取有序集合大小 */
  async zcard(key: string) {
    return this.redis.zcard(key);
  }

  // ── 通用键操作 ──

  /** 删除键 */
  async del(...keys: string[]) {
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  /** 设置过期（秒） */
  async expire(key: string, seconds: number) {
    return this.redis.expire(key, seconds);
  }

  /** 扫描匹配的键 */
  async scanKeys(pattern: string, limit = 100): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, found] = await this.redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', limit,
      );
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== '0');
    return keys;
  }

  /** 批量删除匹配的键 */
  async delByPattern(pattern: string): Promise<number> {
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  /** 设置键值（带过期，秒） */
  async setex(key: string, seconds: number, value: string) {
    return this.redis.setex(key, seconds, value);
  }

  /** 获取键值 */
  async get(key: string) {
    return this.redis.get(key);
  }
}
