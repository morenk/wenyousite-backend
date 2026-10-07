import { Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Prisma 数据库服务：连接管理、生命周期钩子 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  // 模块初始化时自动连接数据库
  async onModuleInit() {
    await this.$connect();
  }

  // Outbox 的 beforeApplicationShutdown 排空完成后才断开数据库连接
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
