import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** 数据库模块：全局单例，所有模块可直接注入 PrismaService */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
