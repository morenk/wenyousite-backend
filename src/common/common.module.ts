import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { TransformInterceptor } from './interceptors/response.interceptor';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

/** 公共模块：全局导出异常、管道、分页基础设施，注册全局拦截器和过滤器 */
@Global()
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    OptionalJwtAuthGuard,
  ],
  exports: [OptionalJwtAuthGuard],
})
export class CommonModule {}
