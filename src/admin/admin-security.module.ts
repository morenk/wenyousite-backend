import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminBearerGuard } from './guards/admin-bearer.guard';
import { AdminGuard } from './guards/admin.guard';

/** 后台 Cookie 会话及前台管理员 Bearer 的认证基础设施。 */
@Module({
  providers: [AdminAuthService, AdminGuard, AdminBearerGuard],
  exports: [AdminAuthService, AdminGuard, AdminBearerGuard],
})
export class AdminSecurityModule {}
