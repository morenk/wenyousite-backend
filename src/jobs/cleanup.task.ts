import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** 定时清理任务：清理过期验证 token、未验证的僵尸用户、过期/已撤销的 refresh token */
@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(private prisma: PrismaService) {}

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

    // 清理 7 天未验证的僵尸用户（软删除）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedUsers = await this.prisma.user.updateMany({
      where: {
        emailVerified: false,
        deletedAt: null,
        createdAt: { lt: sevenDaysAgo },
      },
      data: { deletedAt: new Date() },
    });
    if (deletedUsers.count > 0) {
      this.logger.log(`软删除未验证僵尸用户: ${deletedUsers.count} 条`);
    }
  }
}
