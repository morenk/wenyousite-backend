import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TopicTag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

/** 主题帖标签服务：平台级标签的创建、搜索、查询 */
@Injectable()
export class TagsService {
  private readonly listCacheKey: string;

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private cache: CacheService,
  ) {
    this.listCacheKey = this.cache.buildKey('tags', 'list');
  }

  /** 搜索标签：按名称模糊匹配 */
  async search(q?: string) {
    if (!q) {
      const cached = await this.cache.get<TopicTag[]>(this.listCacheKey);
      if (cached) return cached;

      const tags = await this.prisma.topicTag.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      this.cache.set(this.listCacheKey, tags, 3600000).catch(() => {}); // 1 小时
      return tags;
    }
    return this.prisma.topicTag.findMany({
      where: { isActive: true, name: { contains: q, mode: 'insensitive' } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** 创建标签 */
  async create(dto: CreateTagDto) {
    const existing = await this.prisma.topicTag.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new BusinessException(ErrorCode.TAG_ALREADY_EXISTS, '标签已存在', HttpStatus.CONFLICT);
    }
    const tag = await this.prisma.topicTag.create({
      data: { name: dto.name, color: dto.color },
    });
    await this.invalidateCache();
    this.eventEmitter.emit('tag.created', { tagId: tag.id });
    return tag;
  }

  /** 根据 ID 查询标签 */
  async findById(id: string) {
    const tag = await this.prisma.topicTag.findUnique({ where: { id, isActive: true } });
    if (!tag) throw notFound(ErrorCode.TAG_NOT_FOUND, '标签不存在');
    return tag;
  }

  /** 按名称批量查找或创建标签 */
  async findOrCreate(names: string[]) {
    const tags = await this.prisma.topicTag.findMany({
      where: { name: { in: names } },
    });
    if (tags.some((tag) => tag.isActive === false)) {
      throw new BusinessException(
        ErrorCode.TAXONOMY_STATE_CONFLICT,
        '所选标签已停用',
        HttpStatus.CONFLICT,
      );
    }
    const existingNames = new Set(tags.map((t) => t.name));
    const missing = names.filter((n) => !existingNames.has(n));
    if (missing.length > 0) {
      await this.prisma.topicTag.createMany({
        data: missing.map((name) => ({ name })),
      });
      const created = await this.prisma.topicTag.findMany({
        where: { name: { in: missing }, isActive: true },
      });
      tags.push(...created);
      await this.invalidateCache();
    }
    return tags;
  }

  invalidateCache() {
    return this.cache.del(this.listCacheKey);
  }
}
