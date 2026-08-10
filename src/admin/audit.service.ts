import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AuditClient = PrismaService | Prisma.TransactionClient;

export interface AuditInput {
  actorId?: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  reportId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  requestId?: string | null;
}

/** 所有管理员写操作共用的不可变审计写入器。 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, client: AuditClient = this.prisma) {
    const audit = await client.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        reportId: input.reportId ?? null,
        reason: input.reason ?? null,
        metadata:
          input.metadata == null ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue),
        // 请求上下文单独保存并自动过期，永久审计主体不留 IP 等敏感信息。
        ip: null,
        requestId: null,
      },
    });
    if (input.ip || input.requestId) {
      await client.auditSensitiveContext.create({
        data: {
          auditId: audit.id,
          ip: input.ip ?? null,
          requestId: input.requestId ?? null,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    }
    return audit;
  }
}
