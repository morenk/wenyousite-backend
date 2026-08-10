import { AuditAction, AuditTargetType } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { ThreadCategoriesService } from '../taxonomy/thread-categories.service';
import { AdminTaxonomyService } from './admin-taxonomy.service';
import { AuditService } from './audit.service';

describe('AdminTaxonomyService', () => {
  const tx = {
    threadCategoryDefinition: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    topicTag: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    threadCategoryDefinition: { findMany: jest.fn() },
    topicTag: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const categories = { invalidateCache: jest.fn().mockResolvedValue(undefined) };
  const tags = { invalidateCache: jest.fn().mockResolvedValue(undefined) };
  let service: AdminTaxonomyService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    service = new AdminTaxonomyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      categories as unknown as ThreadCategoriesService,
      tags as unknown as TagsService,
    );
  });

  it('新增分类时规范化 slug 和颜色，并在同一事务记录审计', async () => {
    const created = {
      id: 'c1',
      slug: 'MYSTERY',
      name: '悬疑',
      color: '#AABBCC',
      icon: null,
      sortOrder: 5,
      isActive: true,
    };
    tx.threadCategoryDefinition.create.mockResolvedValue(created);

    await expect(
      service.createCategory(
        { id: 'admin1' },
        { slug: 'mystery', name: ' 悬疑 ', color: '#aabbcc', sortOrder: 5 },
        { requestId: 'req1' },
      ),
    ).resolves.toEqual(created);
    expect(tx.threadCategoryDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'MYSTERY', name: '悬疑', color: '#AABBCC' }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin1',
        action: AuditAction.THREAD_CATEGORY_CREATED,
        targetType: AuditTargetType.THREAD_CATEGORY,
        targetId: 'c1',
      }),
      tx,
    );
    expect(categories.invalidateCache).toHaveBeenCalled();
  });

  it('编辑不存在的分类返回稳定错误码', async () => {
    tx.threadCategoryDefinition.findUnique.mockResolvedValue(null);

    await expect(
      service.updateCategory({ id: 'admin1' }, 'missing', { name: '新名称' }, {}),
    ).rejects.toMatchObject({ errorCode: ErrorCode.THREAD_CATEGORY_NOT_FOUND });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('重命名分类时保留 slug、记录前后值并使公开缓存失效', async () => {
    const existing = {
      id: 'legacy_rpg',
      slug: 'RPG',
      name: '角色扮演',
      description: null,
      color: '#704C65',
      icon: null,
      sortOrder: 30,
      isActive: true,
    };
    const updated = { ...existing, name: '叙事角色扮演', description: '共同讲述角色故事' };
    tx.threadCategoryDefinition.findUnique.mockResolvedValue(existing);
    tx.threadCategoryDefinition.update.mockResolvedValue(updated);

    await expect(
      service.updateCategory(
        { id: 'admin1' },
        existing.id,
        { name: ' 叙事角色扮演 ', description: '共同讲述角色故事' },
        { requestId: 'req-rename' },
      ),
    ).resolves.toEqual(updated);

    expect(tx.threadCategoryDefinition.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { name: '叙事角色扮演', description: '共同讲述角色故事' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.THREAD_CATEGORY_UPDATED,
        targetId: existing.id,
        metadata: expect.objectContaining({
          previous: expect.objectContaining({
            name: '角色扮演',
            description: null,
            slug: 'RPG',
          }),
          current: expect.objectContaining({
            name: '叙事角色扮演',
            description: '共同讲述角色故事',
            slug: 'RPG',
          }),
        }),
      }),
      tx,
    );
    expect(categories.invalidateCache).toHaveBeenCalled();
  });

  it('管理员可以新增标签并使公开标签缓存失效', async () => {
    const created = {
      id: 'tag1',
      name: '无限流',
      color: '#FF6B6B',
      sortOrder: 10,
      isActive: true,
    };
    tx.topicTag.create.mockResolvedValue(created);

    await expect(
      service.createTag(
        { id: 'admin1' },
        { name: ' 无限流 ', color: '#ff6b6b', sortOrder: 10 },
        {},
      ),
    ).resolves.toEqual(created);
    expect(tx.topicTag.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '无限流', color: '#FF6B6B' }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TAG_CREATED,
        targetType: AuditTargetType.TAG,
        targetId: 'tag1',
      }),
      tx,
    );
    expect(tags.invalidateCache).toHaveBeenCalled();
  });
});
