import { Injectable, BadRequestException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { prepareMarkdownContent } from '../common/markdown-content';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { CreateDraftDto } from './dto/create-draft.dto';
import { DiceService } from '../dice/dice.service';
import { hasVisibleMarkdownContent } from '../common/markdown-content';
import { StickerContentService } from '../stickers/sticker-content.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { hashIdempotencyPayload } from '../common/idempotency';
import { isUniqueConstraintViolation } from '../common/prisma-errors';

const DRAFT_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
const DRAFT_PUBLIC_SELECT = {
  id: true,
  userId: true,
  slot: true,
  content: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** 草稿服务：用户级 5 槽位全局草稿池 */
@Injectable()
export class DraftsService {
  constructor(
    private prisma: PrismaService,
    private diceService: DiceService,
    private stickerContent: StickerContentService,
    private mediaReferences: MediaReferenceService,
  ) {}

  /** 获取当前用户所有草稿 */
  async findAll(userId: string) {
    return this.prisma.draft.findMany({
      where: { userId },
      orderBy: { slot: 'asc' },
      select: DRAFT_PUBLIC_SELECT,
    });
  }

  /** 获取单个草稿 */
  async findById(id: string, userId: string) {
    const draft = await this.prisma.draft.findFirst({
      where: { id, userId },
      select: DRAFT_PUBLIC_SELECT,
    });
    if (!draft) throw notFound(ErrorCode.DRAFT_NOT_FOUND, '草稿不存在');
    return draft;
  }

  /** 保存草稿：指定 slot 则覆盖，不指定自动选空闲位 */
  async create(dto: CreateDraftDto, userId: string) {
    const parsedContent = this.diceService.parseContent(prepareMarkdownContent(dto.content));
    this.assertSnapshotNotEmpty(parsedContent.contentWithoutDice, parsedContent.nodes.length);
    const requestHash = hashIdempotencyPayload({
      content: parsedContent.content,
      slot: dto.slot ?? null,
    });
    const replay = await this.findCreateReplay(userId, dto.clientRequestId, requestHash);
    if (replay) return replay;

    if (dto.slot === undefined) {
      await this.stickerContent.assertContentAllowed(userId, parsedContent.content, '');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          return await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
            const existing = await tx.draft.findMany({
              where: { userId },
              select: { slot: true },
            });
            const usedSlots = new Set(existing.map((draft) => draft.slot));
            const slot = [1, 2, 3, 4, 5].find((candidate) => !usedSlots.has(candidate));
            if (!slot) throw new BadRequestException('草稿位已满（5/5），请先删除旧草稿');
            const draft = await tx.draft.create({
              data: {
                userId,
                slot,
                content: parsedContent.content,
                ...this.createIdempotencyData(dto.clientRequestId, requestHash),
              },
              select: DRAFT_PUBLIC_SELECT,
            });
            await this.mediaReferences.syncDraftContent(tx, draft.id, draft.content);
            return draft;
          }, DRAFT_TRANSACTION_OPTIONS);
        } catch (error) {
          const replayAfterRace = await this.findCreateReplayAfterConflict(
            error,
            userId,
            dto.clientRequestId,
            requestHash,
          );
          if (replayAfterRace) return replayAfterRace;
          if (isUniqueConstraintViolation(error) && attempt < 4) continue;
          if (isUniqueConstraintViolation(error)) {
            throw this.optimisticLockConflict();
          }
          throw error;
        }
      }
      throw this.optimisticLockConflict();
    }

    const existing = await this.prisma.draft.findUnique({
      where: { userId_slot: { userId, slot: dto.slot } },
    });
    await this.stickerContent.assertContentAllowed(
      userId,
      parsedContent.content,
      existing?.content ?? '',
    );
    if (existing) {
      if (dto.version === undefined || dto.version !== existing.version) {
        throw this.optimisticLockConflict();
      }
      return this.prisma
        .$transaction(async (tx) => {
          const draft = await tx.draft.update({
            where: { id: existing.id, version: dto.version },
            data: { content: parsedContent.content, version: { increment: 1 } },
            select: DRAFT_PUBLIC_SELECT,
          });
          await this.mediaReferences.syncDraftContent(tx, draft.id, draft.content);
          return draft;
        }, DRAFT_TRANSACTION_OPTIONS)
        .catch((error) => {
          if (error?.code === 'P2025') throw this.optimisticLockConflict();
          throw error;
        });
    }

    // 携带 version 的请求表达“覆盖我读到的旧快照”。目标已经被删除时
    // 不能把它降级成新建，否则离线设备会复活另一设备刚删除的草稿。
    if (dto.version !== undefined) throw this.optimisticLockConflict();

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        const occupied = await tx.draft.findUnique({
          where: { userId_slot: { userId, slot: dto.slot! } },
          select: { id: true },
        });
        if (occupied) throw this.optimisticLockConflict();
        const draft = await tx.draft.create({
          data: {
            userId,
            slot: dto.slot!,
            content: parsedContent.content,
            ...this.createIdempotencyData(dto.clientRequestId, requestHash),
          },
          select: DRAFT_PUBLIC_SELECT,
        });
        await this.mediaReferences.syncDraftContent(tx, draft.id, draft.content);
        return draft;
      }, DRAFT_TRANSACTION_OPTIONS);
    } catch (error) {
      const replayAfterRace = dto.clientRequestId
        ? await this.findCreateReplay(userId, dto.clientRequestId, requestHash)
        : undefined;
      if (replayAfterRace) return replayAfterRace;
      if (isUniqueConstraintViolation(error)) throw this.optimisticLockConflict();
      throw error;
    }
  }

  /** 更新草稿内容 */
  async update(id: string, content: string, version: number, userId: string) {
    const draft = await this.findById(id, userId);
    if (version !== draft.version) throw this.optimisticLockConflict();
    const parsedContent = this.diceService.parseContent(prepareMarkdownContent(content));
    this.assertSnapshotNotEmpty(parsedContent.contentWithoutDice, parsedContent.nodes.length);
    await this.stickerContent.assertContentAllowed(userId, parsedContent.content, draft.content);
    return this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.draft.update({
          where: { id, version },
          data: {
            content: parsedContent.content,
            version: { increment: 1 },
          },
          select: DRAFT_PUBLIC_SELECT,
        });
        await this.mediaReferences.syncDraftContent(tx, updated.id, updated.content);
        return updated;
      }, DRAFT_TRANSACTION_OPTIONS)
      .catch((error) => {
        if (error?.code === 'P2025') throw this.optimisticLockConflict();
        throw error;
      });
  }

  /** 删除草稿 */
  async remove(id: string, userId: string, version?: number) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.draft.findFirst({
        where: { id, userId },
        select: DRAFT_PUBLIC_SELECT,
      });
      if (!draft) return null;
      if (version !== undefined && draft.version !== version) {
        throw this.optimisticLockConflict();
      }
      await this.mediaReferences.releaseDraftContent(tx, id);
      const deleted = await tx.draft.deleteMany({
        where: { id, userId, ...(version !== undefined ? { version } : {}) },
      });
      if (deleted.count === 1) return draft;
      const current = await tx.draft.findFirst({ where: { id, userId }, select: { id: true } });
      if (!current) return null;
      throw this.optimisticLockConflict();
    }, DRAFT_TRANSACTION_OPTIONS);
  }

  /** 原子返回草稿列表和由同一列表推导出的槽位状态。 */
  async state(userId: string) {
    const drafts = await this.prisma.draft.findMany({
      where: { userId },
      orderBy: { slot: 'asc' },
      select: DRAFT_PUBLIC_SELECT,
    });
    return {
      drafts,
      usedSlots: drafts.length,
      maxSlots: 5,
      slots: drafts.map((draft) => draft.slot),
    };
  }

  /** 获取当前用户草稿槽位使用情况 */
  async slotUsage(userId: string) {
    const drafts = await this.prisma.draft.findMany({
      where: { userId },
      select: { slot: true },
      orderBy: { slot: 'asc' },
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

  private createIdempotencyData(clientRequestId: string | undefined, requestHash: string) {
    return clientRequestId ? { clientRequestId, createRequestHash: requestHash } : {};
  }

  private async findCreateReplay(
    userId: string,
    clientRequestId: string | undefined,
    requestHash: string,
  ) {
    if (!clientRequestId) return undefined;
    const existing = await this.prisma.draft.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
      select: { ...DRAFT_PUBLIC_SELECT, createRequestHash: true },
    });
    if (!existing) return undefined;
    if (existing.createRequestHash !== requestHash) {
      throw new BusinessException(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'clientRequestId 已用于不同的草稿创建请求',
        HttpStatus.CONFLICT,
      );
    }
    return {
      id: existing.id,
      userId: existing.userId,
      slot: existing.slot,
      content: existing.content,
      version: existing.version,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  private async findCreateReplayAfterConflict(
    error: unknown,
    userId: string,
    clientRequestId: string | undefined,
    requestHash: string,
  ) {
    if (!isUniqueConstraintViolation(error) || !clientRequestId) return undefined;
    return this.findCreateReplay(userId, clientRequestId, requestHash);
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
