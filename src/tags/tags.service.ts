import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';

/** 主题帖标签服务：平台级标签的创建、搜索、查询 */
@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  /** 搜索标签：按名称模糊匹配 */
  async search(q?: string) {
    if (!q) {
      return this.prisma.topicTag.findMany({ orderBy: { name: 'asc' } });
    }
    return this.prisma.topicTag.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
    });
  }

  /** 创建标签 */
  async create(dto: CreateTagDto) {
    const existing = await this.prisma.topicTag.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('标签已存在');
    }
    return this.prisma.topicTag.create({
      data: { name: dto.name, color: dto.color },
    });
  }

  /** 根据 ID 查询标签 */
  async findById(id: string) {
    const tag = await this.prisma.topicTag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');
    return tag;
  }

  /** 按名称批量查找或创建标签 */
  async findOrCreate(names: string[]) {
    const tags = await this.prisma.topicTag.findMany({
      where: { name: { in: names } },
    });
    const existingNames = new Set(tags.map((t) => t.name));
    const missing = names.filter((n) => !existingNames.has(n));
    if (missing.length > 0) {
      await this.prisma.topicTag.createMany({
        data: missing.map((name) => ({ name })),
      });
      const created = await this.prisma.topicTag.findMany({
        where: { name: { in: missing } },
      });
      tags.push(...created);
    }
    return tags;
  }
}
