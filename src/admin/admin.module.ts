import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';

/** 管理后台模块 */
@Module({
  controllers: [AdminController],
})
export class AdminModule {}
