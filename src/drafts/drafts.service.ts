import { Injectable, NotFoundException, BadRequestException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeMarkdownContent } from '../common/markdown-content';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { CreateDraftDto } from './dto/create-draft.dto';
import { DiceService } from '../dice/dice.service';
import { hasVisibleMarkdownContent } from '../common/markdown-content';

/** 草稿服务：用户级 5 槽位全局草稿池 */
@Injectable()
export class DraftsService {
  constructor(
    private prisma: PrismaService,
    private diceService: DiceService,
  ) {}

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
    const parsedContent = this.diceService.parseContent(normalizeMarkdownContent(dto.content));
    this.assertSnapshotNotEmpty(parsedContent.contentWithoutDice, parsedContent.nodes.length);
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
      if (dto.version === undefined || dto.version !== existing.version) {
        throw this.optimisticLockConflict();
      }
      return this.prisma.draft
        .update({
          where: { id: existing.id, version: dto.version },
          data: { content: parsedContent.content, version: { increment: 1 } },
        })
        .catch((error) => {
          if (error?.code === 'P2025') throw this.optimisticLockConflict();
          throw error;
        });
    }

    return this.prisma.draft.create({
      data: { userId, slot, content: parsedContent.content },
    });
  }

  /** 更新草稿内容 */
  async update(
    id: string,
    content: string,
    version: number,
    userId: string,
  ) {
    const draft = await this.findById(id, userId);
    if (version !== draft.version) throw this.optimisticLockConflict();
    const parsedContent = this.diceService.parseContent(normalizeMarkdownContent(content));
    this.assertSnapshotNotEmpty(parsedContent.contentWithoutDice, parsedContent.nodes.length);
    return this.prisma.draft
      .update({
        where: { id, version },
        data: {
          content: parsedContent.content,
          version: { increment: 1 },
        },
      })
      .catch((error) => {
        if (error?.code === 'P2025') throw this.optimisticLockConflict();
        throw error;
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

  private optimisticLockConflict() {
    return new BusinessException(
      ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      '草稿已在其他位置修改，请刷新后重试',
      HttpStatus.CONFLICT,
    );
  }

  private assertSnapshotNotEmpty(contentWithoutDice: string, diceNodeCount: number) {
    if (!hasVisibleMarkdownContent(contentWithoutDice) && diceNodeCount === 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '草稿正文和待掷骰子不能同时为空',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
