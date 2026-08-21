import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** 管理写操作的唯一审计 Provider。 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
