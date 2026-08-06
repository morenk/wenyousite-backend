import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MediaService } from './media.service';

/** 账号注销后的媒体回收：事务与对象存储解耦，失败时仍由每日孤儿任务兜底。 */
@Injectable()
export class UserMediaCleanupListener {
  private readonly logger = new Logger(UserMediaCleanupListener.name);

  constructor(private readonly mediaService: MediaService) {}

  @OnEvent('user.deleted')
  async handleUserDeleted(event: { userId: string; avatarUrl?: string | null }) {
    if (!event.avatarUrl) return;
    try {
      await this.mediaService.cleanupOrphanByUrl(event.avatarUrl);
    } catch (error) {
      this.logger.warn(`注销头像回收失败 userId=${event.userId}`, error);
    }
  }
}
