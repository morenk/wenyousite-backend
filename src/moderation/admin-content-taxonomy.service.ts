import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { lockModeratedThreadAggregate } from './moderation-content-lock';
import { adminThreadWhere } from '../access/admin-content.where';
import { UpdateContentTaxonomyDto } from '../admin/dto/admin-content.dto';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class AdminContentTaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  async update(
    id: string,
    dto: UpdateContentTaxonomyDto,
    actorId: string,
    context: { ip?: string; requestId?: string },
  ) {
    if (!dto.reason.trim() || (dto.category === undefined && dto.tagIds === undefined)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写修改内容和理由');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockModeratedThreadAggregate(tx, 'THREAD', id);
      const thread = await tx.thread.findFirst({
        where: { id, AND: [adminThreadWhere] },
        select: { version: true, category: true, topicTags: { select: { tagId: true } } },
      });
      if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
      if (thread.version !== dto.version)
        throw new BusinessException(
          ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
          '内容已更新，请刷新后重试',
          HttpStatus.CONFLICT,
        );
      const previousTags = thread.topicTags.map((tag) => tag.tagId).sort();
      const tagIds = dto.tagIds ? [...dto.tagIds].sort() : previousTags;
      const category = dto.category ?? thread.category;
      if (dto.category !== undefined) {
        // 与注册表编辑互斥，确保启停检查直到提交都有效。
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM thread_category_definitions WHERE slug = ${dto.category} FOR SHARE`,
        );
        const selected = await tx.threadCategoryDefinition.findUnique({
          where: { slug: dto.category },
        });
        if (!selected || (!selected.isActive && dto.category !== thread.category)) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择启用的分类');
        }
      }
      if (dto.tagIds !== undefined && tagIds.length) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM topic_tags WHERE id IN (${Prisma.join(tagIds)}) ORDER BY id FOR SHARE`,
        );
        const selected = await tx.topicTag.findMany({
          where: { id: { in: tagIds } },
          select: { id: true, isActive: true },
        });
        if (
          selected.length !== tagIds.length ||
          selected.some((tag) => !tag.isActive && !previousTags.includes(tag.id))
        ) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择启用的标签');
        }
      }
      const updated = await tx.thread.updateMany({
        where: { id, version: dto.version },
        data: {
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new BusinessException(
          ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
          '内容已更新，请刷新后重试',
          HttpStatus.CONFLICT,
        );
      if (dto.tagIds !== undefined) {
        await tx.threadTopicTag.deleteMany({ where: { threadId: id } });
        if (tagIds.length)
          await tx.threadTopicTag.createMany({
            data: tagIds.map((tagId) => ({ threadId: id, tagId })),
          });
      }
      await this.audit.record(
        {
          actorId,
          action: AuditAction.THREAD_TAXONOMY_UPDATED,
          targetType: 'THREAD',
          targetId: id,
          reason: dto.reason.trim(),
          ...context,
          metadata: {
            before: { category: thread.category, tagIds: previousTags, version: thread.version },
            after: { category, tagIds, version: thread.version + 1 },
          },
        },
        tx,
      );
    });
    await Promise.all([
      this.cache.delByPattern(this.cache.buildKey('threads', 'list', '*')),
      this.cache.delByPattern(this.cache.buildKey('thread', '*')),
    ]);
    this.events.emit('thread.updated', { threadId: id });
  }
}
