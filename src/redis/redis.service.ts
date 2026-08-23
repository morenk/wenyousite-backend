import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Redis 底层服务：计数器(Hash)、有序集合(ZSET)、键操作 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  /** 验证 Redis 连接可用，供 readiness 健康检查使用 */
  async ping() {
    return this.redis.ping();
  }

  // ── Hash 计数器 ──

  /** 自增 Hash 字段 */
  async hincrby(key: string, field: string, increment: number) {
    return this.redis.hincrby(key, field, increment);
  }

  /**
   * 先把 Hash 字段提升到指定下限，再原子自增。
   * 用于数据库定期落盘、Redis 实时计数的场景，避免 Redis 重启后计数倒退。
   */
  async hincrbyAtLeast(
    key: string,
    field: string,
    floor: number,
    increment: number,
  ): Promise<number> {
    const result = await this.redis.eval(
      `
        local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
        local floor = tonumber(ARGV[2])
        if current < floor then
          redis.call('HSET', KEYS[1], ARGV[1], floor)
        end
        return redis.call('HINCRBY', KEYS[1], ARGV[1], ARGV[3])
      `,
      1,
      key,
      field,
      String(floor),
      String(increment),
    );
    return Number(result);
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

  /** 原子写入 ZSET 并设置 TTL，避免进程在两条命令之间退出后留下永久快照。 */
  async zaddMultiWithExpiry(
    key: string,
    seconds: number,
    ...scoreMembers: (number | string)[]
  ): Promise<number> {
    if (scoreMembers.length === 0) return 0;
    try {
      const result = await this.redis
        .multi()
        .zadd(key, ...scoreMembers)
        .expire(key, seconds)
        .exec();
      if (
        !result ||
        result.length !== 2 ||
        result.some(([error]) => error !== null) ||
        Number(result[1][1]) !== 1
      ) {
        throw new Error('Redis ZSET snapshot transaction failed');
      }
      return Number(result[0][1]);
    } catch (error) {
      await this.redis.del(key).catch(() => undefined);
      throw error;
    }
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
      const [nextCursor, found] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', limit);
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

  /** 仅在键不存在时写入并设置过期，用于跨实例低成本去重。 */
  async setIfAbsent(key: string, seconds: number, value: string): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', seconds, 'NX');
    return result === 'OK';
  }

  /** 获取键值 */
  async get(key: string) {
    return this.redis.get(key);
  }
}
