import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDraftDto } from './dto/create-draft.dto';

/** 草稿服务：5 槽位自动/手动保存 */
@Injectable()
export class DraftsService {
  constructor(private prisma: PrismaService) {}

  /** 获取当前用户在某子贴下的所有草稿 */
  async findAll(userId: string, subthreadId?: string) {
    const where: any = { userId };
    if (subthreadId) where.subthreadId = subthreadId;
    return this.prisma.draft.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 获取单个草稿 */
  async findById(id: string, userId: string) {
    const draft = await this.prisma.draft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('草稿不存在');
    if (draft.userId !== userId) throw new NotFoundException('草稿不存在');
    return draft;
  }

  /** 保存草稿：指定 slot 则覆盖，不指定则自动选空闲位 */
  async create(dto: CreateDraftDto, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id: dto.subthreadId } });
    if (!subthread) throw new NotFoundException('子贴不存在');

    let slot = dto.slot;

    if (!slot) {
      // 自动选择：找该子贴下空闲草稿位
      const existing = await this.prisma.draft.findMany({
        where: { userId, subthreadId: dto.subthreadId },
        select: { slot: true },
      });
      const usedSlots = new Set(existing.map((d) => d.slot));
      // 找第一个空闲槽位
      let found = false;
      for (let i = 1; i <= 5; i++) {
        if (!usedSlots.has(i)) {
          slot = i;
          found = true;
          break;
        }
      }
      // 如果 5 个槽位都满了，覆盖最旧的
      if (!found) {
        const oldest = await this.prisma.draft.findFirst({
          where: { userId, subthreadId: dto.subthreadId },
          orderBy: { updatedAt: 'asc' },
        });
        await this.prisma.draft.delete({ where: { id: oldest!.id } });
        slot = oldest!.slot;
      }
    } else {
      // 手动选择 slot：检查是否已被占用
      const existing = await this.prisma.draft.findUnique({
        where: { userId_subthreadId_slot: { userId, subthreadId: dto.subthreadId, slot } },
      });
      if (existing) {
        // 覆盖旧草稿
        await this.prisma.draft.delete({ where: { id: existing.id } });
      }
    }

    return this.prisma.draft.create({
      data: {
        userId,
        threadId: subthread.threadId,
        subthreadId: dto.subthreadId,
        slot,
        content: dto.content,
      },
    });
  }

  /** 更新草稿 */
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

  /** 获取当前用户的草稿位使用情况（每子贴 5 槽位的占用数） */
  async slotUsage(userId: string) {
    const drafts = await this.prisma.draft.groupBy({
      by: ['subthreadId'],
      where: { userId },
      _count: { slot: true },
    });
    return drafts.map((d) => ({
      subthreadId: d.subthreadId,
      usedSlots: d._count.slot,
      maxSlots: 5,
    }));
  }
}
