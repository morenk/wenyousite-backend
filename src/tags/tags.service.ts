import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, TopicTag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { isValidTagName, MAX_TAGS_PER_THREAD, normalizeTagName } from './tag-name';

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
    const name = normalizeTagName(dto.name);
    const existing = await this.prisma.topicTag.findUnique({
      where: { name },
    });
    if (existing) {
      throw new BusinessException(ErrorCode.TAG_ALREADY_EXISTS, '标签已存在', HttpStatus.CONFLICT);
    }
    let tag: TopicTag;
    try {
      tag = await this.prisma.topicTag.create({
        data: { name, color: dto.color },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(
          ErrorCode.TAG_ALREADY_EXISTS,
          '标签已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
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
  async findOrCreate(
    names: string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const normalized = [...new Set(names.map(normalizeTagName))];
    if (
      normalized.length > MAX_TAGS_PER_THREAD ||
      normalized.some((name) => !isValidTagName(name))
    ) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `标签最多 ${MAX_TAGS_PER_THREAD} 个，名称只能包含字母、数字、下划线、中文和 #`,
      );
    }

    const tags = await client.topicTag.findMany({
      where: { name: { in: normalized } },
    });
    if (tags.some((tag) => tag.isActive === false)) {
      throw new BusinessException(
        ErrorCode.TAXONOMY_STATE_CONFLICT,
        '所选标签已停用',
        HttpStatus.CONFLICT,
      );
    }
    const existingNames = new Set(tags.map((t) => t.name));
    const missing = normalized.filter((name) => !existingNames.has(name));
    if (missing.length > 0) {
      await client.topicTag.createMany({
        data: missing.map((name) => ({ name })),
        skipDuplicates: true,
      });
      const resolved = await client.topicTag.findMany({
        where: { name: { in: normalized }, isActive: true },
      });
      if (resolved.length !== normalized.length) {
        throw new BusinessException(
          ErrorCode.TAXONOMY_STATE_CONFLICT,
          '所选标签已停用',
          HttpStatus.CONFLICT,
        );
      }
      if (client === this.prisma) await this.invalidateCache();
      const byName = new Map(resolved.map((tag) => [tag.name, tag]));
      return normalized.map((name) => byName.get(name)!);
    }
    const byName = new Map(tags.map((tag) => [tag.name, tag]));
    return normalized.map((name) => byName.get(name)!);
  }

  invalidateCache() {
    return this.cache.del(this.listCacheKey);
  }
}
