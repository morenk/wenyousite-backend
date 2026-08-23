import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

function cacheFailureReason(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 300);
}

function cacheKeyPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function cacheSafe<T>(value: T, ancestors = new WeakSet<object>()): T {
  if (typeof value === 'bigint') return value.toString() as T;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (ancestors.has(value)) throw new TypeError('缓存数据包含循环引用');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cacheSafe(item, ancestors)) as T;
    }

    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return cacheSafe(toJSON.call(value), ancestors) as T;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cacheSafe(item, ancestors),
      ]),
    ) as T;
  } finally {
    ancestors.delete(value);
  }
}

/** 响应缓存服务：封装 cache-manager 的 get/set/del，提供命名空间化的键管理 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  /** 构建缓存键 */
  buildKey(...parts: string[]): string {
    return ['cache', ...parts].join(':');
  }

  /** 获取缓存 */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      return await this.cacheManager.get<T>(key);
    } catch (err) {
      this.logger.warn(`缓存读取失败 key=${key} reason=${cacheFailureReason(err)}`);
      return undefined;
    }
  }

  /** 设置缓存 */
  async set<T = unknown>(key: string, data: T, ttlMs?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, cacheSafe(data), ttlMs);
    } catch (err) {
      this.logger.warn(`缓存写入失败 key=${key} reason=${cacheFailureReason(err)}`);
    }
  }

  /** 删除缓存 */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (err) {
      this.logger.warn(`缓存删除失败 key=${key} reason=${cacheFailureReason(err)}`);
    }
  }

  /** 批量删除匹配模式的缓存键（通过 cache-manager 遍历 store） */
  async delByPattern(pattern: string): Promise<void> {
    try {
      const stores = this.cacheManager.stores;
      if (!stores?.length) return;
      const matches = cacheKeyPattern(pattern);
      const allKeys = new Set<string>();
      for (const store of stores) {
        if (!store.iterator) continue;
        for await (const [key] of store.iterator(undefined)) {
          if (typeof key === 'string' && matches.test(key)) allKeys.add(key);
        }
      }
      if (allKeys.size > 0) {
        await Promise.all([...allKeys].map((key) => this.cacheManager.del(key)));
        this.logger.debug(`批量删除缓存 pattern=${pattern} count=${allKeys.size}`);
      }
    } catch (err) {
      this.logger.warn(`批量缓存删除失败 pattern=${pattern} reason=${cacheFailureReason(err)}`);
    }
  }
}
