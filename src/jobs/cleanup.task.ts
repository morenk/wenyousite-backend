import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** 定时清理任务：清理过期验证 token、未验证的僵尸用户 */
@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(private prisma: PrismaService) {}

  /** 每天凌晨 4 点执行 */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup() {
    // 清理过期邮箱验证 token
    const deletedTokens = await this.prisma.emailVerification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (deletedTokens.count > 0) {
      this.logger.log(`清理过期验证 token: ${deletedTokens.count} 条`);
    }

    // 清理 7 天未验证的用户（刚注册就被遗弃的）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedUsers = await this.prisma.user.deleteMany({
      where: {
        emailVerified: false,
        createdAt: { lt: sevenDaysAgo },
      },
    });
    if (deletedUsers.count > 0) {
      this.logger.log(`清理未验证僵尸用户: ${deletedUsers.count} 条`);
    }
  }
}
