import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheService } from './cache.service';

/**
 * 缓存失效监听器：监听业务事件，清除相关缓存。
 * 事件列表与实际发射点见各模块（ThreadsService、PostsService 等）
 */
@Injectable()
export class CacheInvalidationListener {
  private readonly logger = new Logger(CacheInvalidationListener.name);

  constructor(private readonly cache: CacheService) {}

  // ── 主题帖变更 ──

  /** 帖子发布/修改/删除时，清除帖子详情和列表缓存 */
  @OnEvent('thread.created')
  @OnEvent('thread.updated')
  @OnEvent('thread.published')
  @OnEvent('thread.deleted')
  async handleThreadChange(event: { threadId: string }) {
    const { threadId } = event;
    await this.cache.del(this.cache.buildKey('thread', threadId));
    await this.cache.delByPattern(this.cache.buildKey('threads', 'list', '*'));
    this.logger.debug(`帖子缓存已失效 threadId=${threadId}`);
  }

  // ── 楼层变更（影响帖子活跃度和回复数） ──

  @OnEvent('post.created')
  async handlePostCreated(event: { threadId: string; subthreadId: string; parentPostId?: string | null }) {
    const { threadId, subthreadId, parentPostId } = event;
    // 帖子详情缓存失效
    await this.cache.del(this.cache.buildKey('thread', threadId));
    // 子贴楼层列表缓存失效
    await this.cache.del(this.cache.buildKey('subthread', 'posts', subthreadId));
    // 楼中楼父楼层回复缓存失效
    if (parentPostId) {
      await this.cache.del(this.cache.buildKey('post', 'replies', parentPostId));
    }
    // 列表排序可能变化
    await this.cache.delByPattern(this.cache.buildKey('threads', 'list', '*'));
  }

  @OnEvent('post.updated')
  async handlePostUpdated(event: { threadId: string; postId: string; parentPostId?: string | null }) {
    const { threadId, postId, parentPostId } = event;
    await this.cache.del(this.cache.buildKey('post', postId));
    if (parentPostId) {
      await this.cache.del(this.cache.buildKey('post', 'replies', parentPostId));
    }
    await this.cache.del(this.cache.buildKey('thread', threadId));
  }

  @OnEvent('post.deleted')
  async handlePostDeleted(event: { threadId: string; postId: string; parentPostId?: string | null }) {
    const { threadId, postId, parentPostId } = event;
    await this.cache.del(this.cache.buildKey('post', postId));
    if (parentPostId) {
      await this.cache.del(this.cache.buildKey('post', 'replies', parentPostId));
    }
    await this.cache.del(this.cache.buildKey('thread', threadId));
    await this.cache.delByPattern(this.cache.buildKey('threads', 'list', '*'));
  }

  // ── 主题帖点赞变更（影响缓存） ──

  @OnEvent('thread.liked')
  @OnEvent('thread.unliked')
  async handleThreadLikeChange(event: { threadId: string }) {
    await this.cache.del(this.cache.buildKey('thread', event.threadId));
    await this.cache.delByPattern(this.cache.buildKey('threads', 'list', '*'));
  }

  // ── 用户变更 ──

  @OnEvent('user.updated')
  @OnEvent('user.deleted')
  async handleUserChange(event: { userId: string }) {
    await this.cache.del(this.cache.buildKey('user', event.userId));
    await this.cache.del(this.cache.buildKey('user', 'me', event.userId));
  }

  // ── 标签变更 ──

  @OnEvent('tag.created')
  async handleTagCreated() {
    await this.cache.del(this.cache.buildKey('tags', 'list'));
  }

  // ── 子贴变更 ──

  @OnEvent('subthread.created')
  @OnEvent('subthread.updated')
  @OnEvent('subthread.deleted')
  async handleSubthreadChange(event: { threadId: string; subthreadId: string }) {
    await this.cache.del(this.cache.buildKey('thread', event.threadId));
    await this.cache.del(this.cache.buildKey('subthread', event.subthreadId));
  }
}
