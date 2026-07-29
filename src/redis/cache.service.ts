import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

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
      this.logger.warn(`缓存读取失败 key=${key}`, err);
      return undefined;
    }
  }

  /** 设置缓存 */
  async set<T = unknown>(key: string, data: T, ttlMs?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, data, ttlMs);
    } catch (err) {
      this.logger.warn(`缓存写入失败 key=${key}`, err);
    }
  }

  /** 删除缓存 */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (err) {
      this.logger.warn(`缓存删除失败 key=${key}`, err);
    }
  }

  /** 批量删除匹配模式的缓存键（通过 cache-manager 遍历 store） */
  async delByPattern(pattern: string): Promise<void> {
    try {
      const stores = (this.cacheManager as any).stores as { keys?: (pattern?: string) => Promise<string[]> }[];
      if (!stores) return;
      const allKeys: string[] = [];
      for (const store of stores) {
        if (store.keys) {
          const keys = await store.keys(pattern);
          allKeys.push(...keys);
        }
      }
      if (allKeys.length > 0) {
        await Promise.all(allKeys.map(key => this.cacheManager.del(key)));
        this.logger.debug(`批量删除缓存 pattern=${pattern} count=${allKeys.length}`);
      }
    } catch (err) {
      this.logger.warn(`批量缓存删除失败 pattern=${pattern}`, err);
    }
  }
}
