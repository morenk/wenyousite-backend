import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** ZSET 键名 */
const ZSET_BY_SMART = 'threads:by:smart';

/** 定时清理任务：清理过期验证 token、未验证的僵尸用户、过期/已撤销的 refresh token、废弃草稿帖、已读旧通知 + 智能排序分全量重算 */
@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /** 每天凌晨 4 点执行 */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup() {
    // 清理过期邮箱验证记录（三种类型统一清理）
    const deletedTokens = await this.prisma.emailVerification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (deletedTokens.count > 0) {
      this.logger.log(`清理过期验证记录: ${deletedTokens.count} 条`);
    }

    // 清理过期或已撤销的 refresh token
    const deletedRefresh = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { not: null } },
        ],
      },
    });
    if (deletedRefresh.count > 0) {
      this.logger.log(`清理过期/已撤销 refresh token: ${deletedRefresh.count} 条`);
    }

    // 清理 7 天未验证的僵尸用户（软删除 + 撤销 refresh token）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const zombies = await this.prisma.user.findMany({
      where: {
        emailVerified: false,
        deletedAt: null,
        createdAt: { lt: sevenDaysAgo },
      },
      select: { id: true },
    });
    if (zombies.length > 0) {
      const ids = zombies.map(z => z.id);
      await this.prisma.$transaction([
        this.prisma.user.updateMany({
          where: { id: { in: ids } },
          data: { deletedAt: new Date() },
        }),
        this.prisma.refreshToken.updateMany({
          where: { userId: { in: ids }, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      this.logger.log(`软删除未验证僵尸用户: ${zombies.length} 条`);
    }

    // 清理 7 天未发布的废弃草稿帖（级联删除子贴/帖子/成员）
    const deletedDrafts = await this.prisma.thread.deleteMany({
      where: {
        published: false,
        createdAt: { lt: sevenDaysAgo },
      },
    });
    if (deletedDrafts.count > 0) {
      this.logger.log(`清理废弃草稿帖: ${deletedDrafts.count} 条`);
    }

    // 清理 90 天前的已读通知
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const deletedNotifs = await this.prisma.notification.deleteMany({
      where: {
        isRead: true,
        createdAt: { lt: ninetyDaysAgo },
      },
    });
    if (deletedNotifs.count > 0) {
      this.logger.log(`清理过期已读通知: ${deletedNotifs.count} 条`);
    }
  }

  /** 每 10 分钟全量重算智能排序分：遍历已发布帖，按公式重算 ZSET 分数 */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async recalcSmartScores() {
    const threads = await this.prisma.thread.findMany({
      where: { published: true, deletedAt: null },
      select: { id: true, createdAt: true, viewCount: true },
    });

    if (threads.length === 0) return;

    let updated = 0;
    for (const thread of threads) {
      try {
        const stats = await this.redis.hgetall(`thread:${thread.id}:stats`);
        const views = Math.max(parseInt(stats?.views ?? '0', 10), thread.viewCount);
        const replies = parseInt(stats?.replies ?? '0', 10);
        const likes = parseInt(stats?.likes ?? '0', 10);

        const ageHours = (Date.now() - thread.createdAt.getTime()) / 3600000;
        const engagement = replies * 2 + likes * 3 + views * 0.3;
        const score = engagement / Math.pow(ageHours + 2, 1.5);

        await this.redis.zadd(ZSET_BY_SMART, score, thread.id);
        updated++;
      } catch (err) {
        this.logger.warn(`重算智能排序分失败 threadId=${thread.id}`, err);
      }
    }
    if (updated > 0) {
      this.logger.log(`智能排序分全量重算完成: ${updated} 个帖子`);
    }
  }
}
