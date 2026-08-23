import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCategorySlug } from './category-slug';

type CategoryClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ThreadCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive() {
    return this.prisma.threadCategoryDefinition.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  async assertSelectable(slug: string, client: CategoryClient = this.prisma): Promise<string> {
    const normalized = normalizeCategorySlug(slug);
    const category = await client.threadCategoryDefinition.findUnique({
      where: { slug: normalized },
      select: { slug: true, isActive: true },
    });
    if (!category) {
      throw notFound(ErrorCode.THREAD_CATEGORY_NOT_FOUND, '主题帖分类不存在');
    }
    if (!category.isActive) {
      throw new BusinessException(
        ErrorCode.TAXONOMY_STATE_CONFLICT,
        '主题帖分类已停用',
        HttpStatus.CONFLICT,
      );
    }
    return category.slug;
  }
}
