import { createHash } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, StickerAsset } from '@prisma/client';
import { Queue } from 'bullmq';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import {
  ImportStickerDirectMessageDto,
  ImportStickerMediaDto,
  ImportStickerPostImageDto,
  ReorderStickersDto,
} from './dto/sticker.dto';
import {
  STICKER_COLLECTION_LIMIT,
  STICKER_MAX_ANIMATED_BYTES,
  STICKER_MAX_ANIMATION_MS,
  STICKER_MAX_EDGE,
  STICKER_MAX_FRAMES,
  STICKER_MAX_INPUT_BYTES,
  STICKER_MAX_STATIC_BYTES,
  STICKER_RECENT_LIMIT,
} from './sticker.constants';
import { StickerContentService } from './sticker-content.service';
import { StickerStorageService } from './sticker-storage.service';

export interface StickerProcessJob {
  importId: string;
}

const favoriteInclude = {
  asset: {
    select: {
      id: true,
      url: true,
      thumbnailUrl: true,
      width: true,
      height: true,
      animated: true,
      frameCount: true,
      durationMs: true,
    },
  },
} satisfies Prisma.UserStickerInclude;

type FavoriteRecord = Prisma.UserStickerGetPayload<{ include: typeof favoriteInclude }>;

/** 用户私有表情收藏、来源导入、转码去重与排序。 */
@Injectable()
export class StickersService {
  private readonly logger = new Logger(StickersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
    private readonly content: StickerContentService,
    private readonly storage: StickerStorageService,
    @InjectQueue('sticker') private readonly queue: Queue,
  ) {}

  async getCollection(userId: string) {
    const collection = await this.prisma.stickerCollection.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const [items, recent, pending] = await Promise.all([
      this.prisma.userSticker.findMany({
        where: { userId },
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        include: favoriteInclude,
      }),
      this.prisma.userSticker.findMany({
        where: { userId, lastUsedAt: { not: null } },
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
        take: STICKER_RECENT_LIMIT,
        include: favoriteInclude,
      }),
      this.prisma.stickerImport.findMany({
        where: { userId, status: 'PROCESSING' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      version: collection.version,
      limit: STICKER_COLLECTION_LIMIT,
      items: items.map((item) => this.mapFavorite(item)),
      recent: recent.map((item) => this.mapFavorite(item)),
      pendingImports: pending.map((item) => this.mapImport(item, null)),
    };
  }

  async importMedia(userId: string, dto: ImportStickerMediaDto) {
    const media = await this.prisma.media.findFirst({
      where: { id: dto.mediaId, userId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!media) throw this.invalid('图片不存在、尚未处理完成或不属于当前账号');
    return this.startMediaImport(userId, media.id, dto.clientRequestId);
  }

  async importDirectMessage(userId: string, dto: ImportStickerDirectMessageDto) {
    const message = await this.prisma.directMessage.findFirst({
      where: {
        id: dto.directMessageId,
        recalledAt: null,
        conversation: { participants: { some: { userId } } },
      },
      select: { mediaId: true, stickerAssetId: true },
    });
    if (!message || (!message.mediaId && !message.stickerAssetId)) {
      throw notFound(ErrorCode.STICKER_NOT_FOUND, '消息中的图片或表情不存在');
    }
    if (message.stickerAssetId) {
      return this.addExistingAsset(userId, message.stickerAssetId, dto.clientRequestId);
    }
    return this.startMediaImport(userId, message.mediaId!, dto.clientRequestId);
  }

  async importPostImage(userId: string, dto: ImportStickerPostImageDto) {
    const post = await this.prisma.post.findUnique({
      where: { id: dto.postId, deletedAt: null },
      select: { threadId: true, content: true },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(post.threadId, userId);
    const token = this.content.extract(post.content).find((item) => item.url === dto.imageUrl);
    if (!token) throw notFound(ErrorCode.STICKER_NOT_FOUND, '帖子中的图片不存在');
    if (token.stickerAssetId) {
      const asset = await this.prisma.stickerAsset.findFirst({
        where: { id: token.stickerAssetId, url: token.url },
        select: { id: true },
      });
      if (!asset) throw notFound(ErrorCode.STICKER_NOT_FOUND, '表情资产不存在');
      return this.addExistingAsset(userId, asset.id, dto.clientRequestId);
    }
    const media = await this.prisma.media.findFirst({
      where: { url: token.url, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!media) throw this.invalid('该图片不是可收藏的站内图片');
    return this.startMediaImport(userId, media.id, dto.clientRequestId);
  }

  async getImport(userId: string, id: string) {
    const item = await this.prisma.stickerImport.findFirst({ where: { id, userId } });
    if (!item) throw notFound(ErrorCode.STICKER_NOT_FOUND, '表情导入记录不存在');
    const favorite = item.assetId
      ? await this.prisma.userSticker.findUnique({
          where: { userId_assetId: { userId, assetId: item.assetId } },
          include: favoriteInclude,
        })
      : null;
    return this.mapImport(item, favorite);
  }

  async reorder(userId: string, dto: ReorderStickersDto) {
    if (new Set(dto.favoriteIds).size !== dto.favoriteIds.length) {
      throw this.invalid('排序列表不能包含重复收藏');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockCollection(tx, userId);
      const collection = await tx.stickerCollection.findUniqueOrThrow({ where: { userId } });
      if (collection.version !== dto.version) throw this.versionConflict();
      const favorites = await tx.userSticker.findMany({
        where: { userId },
        select: { id: true },
      });
      if (
        favorites.length !== dto.favoriteIds.length ||
        favorites.some((favorite) => !dto.favoriteIds.includes(favorite.id))
      ) {
        throw this.versionConflict('收藏夹内容已变化，请刷新后重试');
      }
      for (let position = 0; position < dto.favoriteIds.length; position++) {
        await tx.userSticker.update({
          where: { id: dto.favoriteIds[position] },
          data: { position },
        });
      }
      await tx.stickerCollection.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
    });
    return this.getCollection(userId);
  }

  async remove(userId: string, favoriteId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockCollection(tx, userId);
      const favorite = await tx.userSticker.findFirst({ where: { id: favoriteId, userId } });
      if (!favorite) throw notFound(ErrorCode.STICKER_NOT_FOUND, '收藏的表情不存在');
      await tx.userSticker.delete({ where: { id: favorite.id } });
      await tx.userSticker.updateMany({
        where: { userId, position: { gt: favorite.position } },
        data: { position: { decrement: 1 } },
      });
      await tx.stickerCollection.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
    });
    return this.getCollection(userId);
  }

  async assertFavorite(
    userId: string,
    assetId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const favorite = await tx.userSticker.findUnique({
      where: { userId_assetId: { userId, assetId } },
      include: { asset: true },
    });
    if (!favorite) throw notFound(ErrorCode.STICKER_NOT_FOUND, '表情不在当前收藏夹中');
    return favorite;
  }

  async recordUsage(userId: string, assetId: string, tx: Prisma.TransactionClient = this.prisma) {
    await tx.userSticker.updateMany({
      where: { userId, assetId },
      data: { lastUsedAt: new Date() },
    });
  }

  async processImport(importId: string) {
    const item = await this.prisma.stickerImport.findUnique({
      where: { id: importId },
      include: { sourceMedia: true },
    });
    if (!item || item.status !== 'PROCESSING' || !item.sourceMedia) return;
    const source = item.sourceMedia;
    if (source.status !== 'COMPLETED') throw this.invalid('来源图片尚未处理完成');
    if ((source.size ?? 0) > STICKER_MAX_INPUT_BYTES) throw this.invalid('来源图片超过 10MB');

    const input = await this.storage.download(source.key);
    if (input.length > STICKER_MAX_INPUT_BYTES) throw this.invalid('来源图片超过 10MB');
    const normalized = await this.normalize(input);
    const hash = createHash('sha256').update(normalized.main).digest('hex');
    let asset = await this.prisma.stickerAsset.findUnique({ where: { contentHash: hash } });
    if (!asset) {
      const prefix = hash.slice(0, 2);
      const key = `stickers/${prefix}/${hash}.webp`;
      const thumbnailKey = `stickers/${prefix}/${hash}_thumb.webp`;
      await Promise.all([
        this.storage.upload(key, normalized.main),
        this.storage.upload(thumbnailKey, normalized.thumbnail),
      ]);
      try {
        asset = await this.prisma.stickerAsset.create({
          data: {
            key,
            url: this.storage.publicUrl(key),
            thumbnailKey,
            thumbnailUrl: this.storage.publicUrl(thumbnailKey),
            contentHash: hash,
            contentType: 'image/webp',
            size: normalized.main.length,
            width: normalized.width,
            height: normalized.height,
            animated: normalized.animated,
            frameCount: normalized.frameCount,
            durationMs: normalized.durationMs,
          },
        });
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        asset = await this.prisma.stickerAsset.findUniqueOrThrow({ where: { contentHash: hash } });
      }
    }
    await this.completeImport(item.id, item.userId, asset);
  }

  async markImportFailed(importId: string, error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 500) : '表情处理失败';
    await this.prisma.stickerImport.updateMany({
      where: { id: importId, status: 'PROCESSING' },
      data: { status: 'FAILED', failureCode: 'PROCESSING_FAILED', failureMessage: message },
    });
    this.logger.warn(`Sticker import failed importId=${importId}: ${message}`);
  }

  async cleanupOrphanAssets() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.prisma.stickerImport.deleteMany({
      where: { status: { in: ['COMPLETED', 'FAILED'] }, updatedAt: { lt: cutoff } },
    });
    // 已完成资产还可能被帖子或草稿中的 Markdown 字符串引用。引用扫描与对象删除
    // 无法在同一事务中原子复核，自动删除会在并发保存正文时造成不可逆的数据丢失。
    // 建立规范化 StickerAsset 引用账本前，仅清理终态导入记录，保守保留资产。
  }

  private async startMediaImport(userId: string, mediaId: string, clientRequestId: string) {
    const existing = await this.prisma.stickerImport.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
    });
    if (existing) return this.getImport(userId, existing.id);

    const item = await this.prisma
      .$transaction(async (tx) => {
        await this.lockCollection(tx, userId);
        await this.assertCapacity(tx, userId);
        return tx.stickerImport.create({
          data: { userId, sourceMediaId: mediaId, clientRequestId },
        });
      })
      .catch(async (error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          return this.prisma.stickerImport.findUniqueOrThrow({
            where: { userId_clientRequestId: { userId, clientRequestId } },
          });
        }
        throw error;
      });
    if (item.status === 'PROCESSING') {
      try {
        await this.queue.add('process', { importId: item.id } satisfies StickerProcessJob, {
          jobId: item.id,
          attempts: 2,
          backoff: { type: 'fixed', delay: 10_000 },
          removeOnComplete: { age: 86_400 },
          removeOnFail: { age: 604_800 },
        });
      } catch (error) {
        await this.markImportFailed(item.id, error);
      }
    }
    return this.getImport(userId, item.id);
  }

  private async addExistingAsset(userId: string, assetId: string, clientRequestId: string) {
    const existing = await this.prisma.stickerImport.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
    });
    if (existing) return this.getImport(userId, existing.id);
    const asset = await this.prisma.stickerAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw notFound(ErrorCode.STICKER_NOT_FOUND, '表情资产不存在');

    const importId = await this.prisma
      .$transaction(async (tx) => {
        await this.lockCollection(tx, userId);
        const favorite = await tx.userSticker.findUnique({
          where: { userId_assetId: { userId, assetId } },
        });
        let alreadySaved = Boolean(favorite);
        if (!favorite) {
          await this.assertCapacity(tx, userId);
          await this.createFavorite(tx, userId, assetId);
          alreadySaved = false;
        }
        const item = await tx.stickerImport.create({
          data: { userId, clientRequestId, assetId, status: 'COMPLETED', alreadySaved },
        });
        return item.id;
      })
      .catch(async (error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          return (
            await this.prisma.stickerImport.findUniqueOrThrow({
              where: { userId_clientRequestId: { userId, clientRequestId } },
            })
          ).id;
        }
        throw error;
      });
    return this.getImport(userId, importId);
  }

  private async completeImport(importId: string, userId: string, asset: StickerAsset) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockCollection(tx, userId);
      const current = await tx.stickerImport.findUnique({ where: { id: importId } });
      if (!current || current.status !== 'PROCESSING') return;
      const favorite = await tx.userSticker.findUnique({
        where: { userId_assetId: { userId, assetId: asset.id } },
      });
      if (!favorite) await this.createFavorite(tx, userId, asset.id);
      await tx.stickerImport.update({
        where: { id: importId },
        data: { status: 'COMPLETED', assetId: asset.id, alreadySaved: Boolean(favorite) },
      });
    });
  }

  private async createFavorite(tx: Prisma.TransactionClient, userId: string, assetId: string) {
    await tx.userSticker.updateMany({ where: { userId }, data: { position: { increment: 1 } } });
    await tx.userSticker.create({ data: { userId, assetId, position: 0 } });
    await tx.stickerCollection.update({
      where: { userId },
      data: { version: { increment: 1 } },
    });
  }

  private async lockCollection(tx: Prisma.TransactionClient, userId: string) {
    await tx.stickerCollection.upsert({ where: { userId }, create: { userId }, update: {} });
    await tx.$queryRaw`SELECT user_id FROM sticker_collections WHERE user_id = ${userId} FOR UPDATE`;
  }

  private async assertCapacity(tx: Prisma.TransactionClient, userId: string) {
    const [favorites, processing] = await Promise.all([
      tx.userSticker.count({ where: { userId } }),
      tx.stickerImport.count({ where: { userId, status: 'PROCESSING' } }),
    ]);
    if (favorites + processing >= STICKER_COLLECTION_LIMIT) {
      throw new BusinessException(
        ErrorCode.STICKER_LIMIT_REACHED,
        `表情收藏已达到 ${STICKER_COLLECTION_LIMIT} 个上限`,
        HttpStatus.CONFLICT,
      );
    }
  }

  private async normalize(input: Buffer) {
    const metadata = await sharp(input, { animated: true }).metadata();
    const width = metadata.width ?? 0;
    const pageHeight = metadata.pageHeight ?? metadata.height ?? 0;
    const frameCount = metadata.pages ?? 1;
    const animated = frameCount > 1;
    const durationMs = (metadata.delay ?? []).reduce((sum, delay) => sum + delay, 0);
    const decodedPixels = width * pageHeight * frameCount;
    const pixelLimit = animated ? 120_000_000 : 40_000_000;
    if (!width || !pageHeight || decodedPixels > pixelLimit) throw this.invalid('图片像素尺寸过大');
    if (frameCount > STICKER_MAX_FRAMES) throw this.invalid('动图不能超过 120 帧');
    if (durationMs > STICKER_MAX_ANIMATION_MS) throw this.invalid('动图不能超过 15 秒');

    const main = await sharp(input, { animated, limitInputPixels: pixelLimit })
      .rotate()
      .resize({
        width: STICKER_MAX_EDGE,
        height: STICKER_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: animated ? 80 : 82, effort: 5, loop: metadata.loop ?? 0 })
      .toBuffer();
    const maxOutput = animated ? STICKER_MAX_ANIMATED_BYTES : STICKER_MAX_STATIC_BYTES;
    if (main.length > maxOutput) {
      throw this.invalid(animated ? '处理后的动图超过 4MB' : '处理后的图片超过 2MB');
    }
    const outputMetadata = await sharp(main, { animated }).metadata();
    const thumbnail = await sharp(main, { page: 0 })
      .resize(128, 128, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76, effort: 5 })
      .toBuffer();
    return {
      main,
      thumbnail,
      width: outputMetadata.width ?? width,
      height: outputMetadata.pageHeight ?? outputMetadata.height ?? pageHeight,
      animated,
      frameCount,
      durationMs,
    };
  }

  private mapFavorite(item: FavoriteRecord) {
    return {
      id: item.id,
      position: item.position,
      lastUsedAt: item.lastUsedAt,
      asset: item.asset,
      markdown: this.content.markdown(item.asset),
    };
  }

  private mapImport(
    item: {
      id: string;
      status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
      failureCode: string | null;
      failureMessage: string | null;
      alreadySaved: boolean;
    },
    favorite: FavoriteRecord | null,
  ) {
    return {
      id: item.id,
      status: item.status,
      favorite: favorite ? this.mapFavorite(favorite) : null,
      failureCode: item.failureCode,
      failureMessage: item.failureMessage,
      alreadySaved: item.alreadySaved,
    };
  }

  private invalid(message: string) {
    return new BusinessException(ErrorCode.INVALID_STICKER, message, HttpStatus.BAD_REQUEST);
  }

  private versionConflict(message = '收藏夹已在其他设备修改，请刷新后重试') {
    return new BusinessException(
      ErrorCode.STICKER_COLLECTION_VERSION_CONFLICT,
      message,
      HttpStatus.CONFLICT,
    );
  }
}
