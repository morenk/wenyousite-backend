import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { TransformInterceptor } from './interceptors/response.interceptor';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { AdminBearerGuard } from './guards/admin-bearer.guard';
import { AdminAuthService } from '../admin/admin-auth.service';
import { SiteOperationalSettingsService } from '../admin/site-operational-settings.service';
import { OperationalSettingsGuard } from './guards/operational-settings.guard';
import { AuditService } from '../admin/audit.service';

/** 公共模块：全局导出异常、管道、分页基础设施，注册全局拦截器和过滤器 */
@Global()
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    OptionalJwtAuthGuard,
    AdminAuthService,
    AuditService,
    SiteOperationalSettingsService,
    AdminGuard,
    AdminBearerGuard,
    { provide: APP_GUARD, useClass: OperationalSettingsGuard },
  ],
  exports: [
    OptionalJwtAuthGuard,
    AdminAuthService,
    AdminGuard,
    AdminBearerGuard,
    AuditService,
    SiteOperationalSettingsService,
  ],
})
export class CommonModule {}
