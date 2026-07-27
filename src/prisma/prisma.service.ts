import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Prisma 数据库服务：连接管理、生命周期钩子 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // 模块初始化时自动连接数据库
  async onModuleInit() {
    await this.$connect();
  }

  // 模块销毁时自动断开数据库连接
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
