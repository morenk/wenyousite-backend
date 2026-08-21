import { HttpStatus, Injectable } from '@nestjs/common';
import { ThreadVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { hashIdempotencyPayload } from '../common/idempotency';
import { CreateThreadDto } from './dto/create-thread.dto';
import { ThreadQueryService } from './thread-query.service';
import { normalizeCategorySlug } from '../taxonomy/category-slug';
import { isUniqueConstraintViolation } from '../common/prisma-errors';

/** 主题帖创建幂等协调：集中处理正常重放、并发唯一键竞争与载荷误用。 */
@Injectable()
export class ThreadCreateIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: ThreadQueryService,
  ) {}

  prepare(dto: CreateThreadDto, normalizedContent: string) {
    const title = dto.title ?? '未命名草稿';
    const subthreadTitle = dto.subthreadTitle ?? title;
    const category = dto.category ? normalizeCategorySlug(dto.category) : undefined;
    const visibility = (dto.visibility ?? ThreadVisibility.PUBLIC) as ThreadVisibility;
    return {
      title,
      subthreadTitle,
      category,
      visibility,
      requestHash: hashIdempotencyPayload({
        title,
        subthreadTitle,
        category,
        visibility,
        content: normalizedContent,
        tagNames: [...(dto.tagNames ?? [])].sort(),
      }),
    };
  }

  async findReplay(userId: string, clientRequestId: string | undefined, requestHash: string) {
    if (!clientRequestId) return undefined;
    const existing = await this.prisma.thread.findFirst({
      where: { ownerId: userId, clientRequestId },
      select: { id: true, createRequestHash: true },
    });
    if (!existing) return undefined;
    if (existing.createRequestHash !== requestHash) {
      throw new BusinessException(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'clientRequestId 已用于不同的主题帖创建请求',
        HttpStatus.CONFLICT,
      );
    }
    return this.queries.findById(existing.id, userId);
  }

  async findReplayAfterConflict(
    error: unknown,
    userId: string,
    clientRequestId: string | undefined,
    requestHash: string,
  ) {
    if (!isUniqueConstraintViolation(error) || !clientRequestId) return undefined;
    return this.findReplay(userId, clientRequestId, requestHash);
  }
}
