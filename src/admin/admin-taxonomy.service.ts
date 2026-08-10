import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { normalizeCategorySlug } from '../taxonomy/category-slug';
import {
  CreateThreadCategoryDto,
  UpdateThreadCategoryDto,
} from '../taxonomy/dto/thread-category.dto';
import { ThreadCategoriesService } from '../taxonomy/thread-categories.service';
import { AuditService } from './audit.service';
import { CreateManagedTagDto, UpdateManagedTagDto } from './dto/taxonomy.dto';

interface TaxonomyActor {
  id: string;
}

interface TaxonomyRequestContext {
  ip?: string;
  requestId?: string;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function categoryMetadata(value: {
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
}) {
  return {
    slug: value.slug,
    name: value.name,
    description: value.description,
    color: value.color,
    icon: value.icon,
    sortOrder: value.sortOrder,
    isActive: value.isActive,
  };
}

@Injectable()
export class AdminTaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: ThreadCategoriesService,
    private readonly tags: TagsService,
  ) {}

  listCategories() {
    return this.prisma.threadCategoryDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  listTags() {
    return this.prisma.topicTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(
    actor: TaxonomyActor,
    dto: CreateThreadCategoryDto,
    context: TaxonomyRequestContext,
  ) {
    const { reason, ...input } = dto;
    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await tx.threadCategoryDefinition.create({
          data: {
            ...input,
            slug: normalizeCategorySlug(input.slug),
            name: input.name.trim(),
            color: input.color?.toUpperCase(),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.THREAD_CATEGORY_CREATED,
            targetType: AuditTargetType.THREAD_CATEGORY,
            targetId: created.id,
            reason,
            metadata: categoryMetadata(created),
            ...context,
          },
          tx,
        );
        return created;
      });
      await this.categories.invalidateCache();
      return category;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new BusinessException(
          ErrorCode.THREAD_CATEGORY_ALREADY_EXISTS,
          '分类标识或名称已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async updateCategory(
    actor: TaxonomyActor,
    id: string,
    dto: UpdateThreadCategoryDto,
    context: TaxonomyRequestContext,
  ) {
    const { reason, ...input } = dto;
    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.threadCategoryDefinition.findUnique({ where: { id } });
        if (!existing) {
          throw notFound(ErrorCode.THREAD_CATEGORY_NOT_FOUND, '主题帖分类不存在');
        }
        const updated = await tx.threadCategoryDefinition.update({
          where: { id },
          data: {
            ...input,
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.color !== undefined ? { color: input.color?.toUpperCase() ?? null } : {}),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.THREAD_CATEGORY_UPDATED,
            targetType: AuditTargetType.THREAD_CATEGORY,
            targetId: updated.id,
            reason,
            metadata: {
              previous: categoryMetadata(existing),
              current: categoryMetadata(updated),
            },
            ...context,
          },
          tx,
        );
        return updated;
      });
      await this.categories.invalidateCache();
      return category;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new BusinessException(
          ErrorCode.THREAD_CATEGORY_ALREADY_EXISTS,
          '分类名称已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async createTag(actor: TaxonomyActor, dto: CreateManagedTagDto, context: TaxonomyRequestContext) {
    const { reason, ...input } = dto;
    try {
      const tag = await this.prisma.$transaction(async (tx) => {
        const created = await tx.topicTag.create({
          data: {
            ...input,
            name: input.name.trim(),
            color: input.color?.toUpperCase(),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.TAG_CREATED,
            targetType: AuditTargetType.TAG,
            targetId: created.id,
            reason,
            metadata: {
              name: created.name,
              color: created.color,
              sortOrder: created.sortOrder,
              isActive: created.isActive,
            },
            ...context,
          },
          tx,
        );
        return created;
      });
      await this.tags.invalidateCache();
      return tag;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new BusinessException(
          ErrorCode.TAG_ALREADY_EXISTS,
          '标签已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async updateTag(
    actor: TaxonomyActor,
    id: string,
    dto: UpdateManagedTagDto,
    context: TaxonomyRequestContext,
  ) {
    const { reason, ...input } = dto;
    try {
      const tag = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.topicTag.findUnique({ where: { id } });
        if (!existing) throw notFound(ErrorCode.TAG_NOT_FOUND, '标签不存在');
        const updated = await tx.topicTag.update({
          where: { id },
          data: {
            ...input,
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.color !== undefined ? { color: input.color?.toUpperCase() ?? null } : {}),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.TAG_UPDATED,
            targetType: AuditTargetType.TAG,
            targetId: updated.id,
            reason,
            metadata: {
              previous: {
                name: existing.name,
                color: existing.color,
                sortOrder: existing.sortOrder,
                isActive: existing.isActive,
              },
              current: {
                name: updated.name,
                color: updated.color,
                sortOrder: updated.sortOrder,
                isActive: updated.isActive,
              },
            },
            ...context,
          },
          tx,
        );
        return updated;
      });
      await this.tags.invalidateCache();
      return tag;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new BusinessException(
          ErrorCode.TAG_ALREADY_EXISTS,
          '标签已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}
