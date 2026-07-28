import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDraftDto } from './dto/create-draft.dto';

/** 草稿服务：用户级 5 槽位全局草稿池 */
@Injectable()
export class DraftsService {
  constructor(private prisma: PrismaService) {}

  /** 获取当前用户所有草稿 */
  async findAll(userId: string) {
    return this.prisma.draft.findMany({
      where: { userId },
      orderBy: { slot: 'asc' },
    });
  }

  /** 获取单个草稿 */
  async findById(id: string, userId: string) {
    const draft = await this.prisma.draft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('草稿不存在');
    if (draft.userId !== userId) throw new NotFoundException('草稿不存在');
    return draft;
  }

  /** 保存草稿：指定 slot 则覆盖，不指定自动选空闲位 */
  async create(dto: CreateDraftDto, userId: string) {
    let slot = dto.slot;

    if (!slot) {
      const existing = await this.prisma.draft.findMany({
        where: { userId },
        select: { slot: true },
      });
      const usedSlots = new Set(existing.map((d) => d.slot));
      for (let i = 1; i <= 5; i++) {
        if (!usedSlots.has(i)) {
          slot = i;
          break;
        }
      }
      if (!slot) throw new BadRequestException('草稿位已满（5/5），请先删除旧草稿');
    }

    const existing = await this.prisma.draft.findUnique({
      where: { userId_slot: { userId, slot } },
    });

    if (existing) {
      return this.prisma.draft.update({
        where: { id: existing.id },
        data: { content: dto.content },
      });
    }

    return this.prisma.draft.create({
      data: { userId, slot, content: dto.content },
    });
  }

  /** 更新草稿内容 */
  async update(id: string, content: string, userId: string) {
    const draft = await this.findById(id, userId);
    return this.prisma.draft.update({
      where: { id },
      data: { content },
    });
  }

  /** 删除草稿 */
  async remove(id: string, userId: string) {
    await this.findById(id, userId);
    return this.prisma.draft.delete({ where: { id } });
  }

  /** 获取当前用户草稿槽位使用情况 */
  async slotUsage(userId: string) {
    const drafts = await this.prisma.draft.findMany({
      where: { userId },
      select: { slot: true },
    });
    return {
      usedSlots: drafts.length,
      maxSlots: 5,
      slots: drafts.map((d) => d.slot),
    };
  }
}
