import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityService } from './activity.service';

/** 产品活跃事实模块：跨实例去重采集普通用户每日活跃。 */
@Module({
  providers: [ActivityService, { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor }],
  exports: [ActivityService],
})
export class ActivityModule {}
