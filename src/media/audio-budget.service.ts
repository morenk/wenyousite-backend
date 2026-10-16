import { BadRequestException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Media, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export const AUDIO_UPLOAD_LEASE_MS = 15 * 60 * 1000;
const purpose = 'RICH_CONTENT_AUDIO' as const;

export function audioActiveWhere(userId: string, now: Date): Prisma.MediaWhereInput {
  return { userId, purpose, deletionClaimedAt: null, OR: [
    { status: 'PROCESSING' },
    { status: 'UPLOADING', OR: [
      { audioUploadLeaseUntil: { gt: now } },
      { audioUploadLeaseUntil: null, createdAt: { gt: new Date(now.getTime() - AUDIO_UPLOAD_LEASE_MS) } },
    ] },
  ] };
}

/** PostgreSQL 权威准入；不把 Redis 计数或对象下载后的 size 当成输入账本。 */
@Injectable()
export class AudioBudgetService {
  private readonly maxActive: number;
  private readonly dailyBytes: number;
  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.maxActive = config.get<number>('audio.maxActiveUploads') ?? 2;
    this.dailyBytes = config.get<number>('audio.dailyInputBytes') ?? 300 * 1024 * 1024;
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    // 不升级为 FOR UPDATE：保留其他领域外键的 KEY SHARE，遵循用户→媒体锁序。
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
    if (!users.length) throw new NotFoundException('用户不存在');
  }

  private async assertSlot(tx: Prisma.TransactionClient, userId: string, now: Date, exceptId?: string) {
    const count = await tx.media.count({ where: { ...audioActiveWhere(userId, now), ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (count >= this.maxActive) throw new BusinessException(ErrorCode.AUDIO_ACTIVE_LIMIT, '音频上传或处理中，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }

  async create(data: Prisma.MediaUncheckedCreateInput, inputBytes: number, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, data.userId);
      await this.assertSlot(tx, data.userId, now);
      const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      const day = { userId: data.userId, purpose, createdAt: { gte: start, lt: end } };
      const sum = await tx.media.aggregate({ where: day, _sum: { audioInputBytes: true } });
      const legacy = await tx.media.aggregate({ where: { ...day, audioInputBytes: null, status: { in: ['UPLOADING', 'PROCESSING'] } }, _sum: { size: true } });
      if ((sum._sum.audioInputBytes ?? 0) + (legacy._sum.size ?? 0) + inputBytes > this.dailyBytes) throw new BusinessException(ErrorCode.AUDIO_DAILY_BYTES_LIMIT, '音频上传额度已用完，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
      return tx.media.create({ data: { ...data, purpose, audioInputBytes: inputBytes, audioUploadLeaseUntil: new Date(now.getTime() + AUDIO_UPLOAD_LEASE_MS), createdAt: now } });
    });
  }

  private async lockedMedia(tx: Prisma.TransactionClient, mediaId: string, userId: string): Promise<Media> {
    await this.lockUser(tx, userId);
    await tx.$queryRaw`SELECT id FROM media WHERE id = ${mediaId} FOR UPDATE`;
    const media = await tx.media.findUnique({ where: { id: mediaId, deletionClaimedAt: null } });
    if (!media) throw new NotFoundException('媒体记录不存在');
    if (media.userId !== userId) throw new ForbiddenException('无权操作');
    if (media.purpose !== purpose) throw new BadRequestException('音频用途不匹配');
    return media;
  }

  async renew(mediaId: string, userId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const media = await this.lockedMedia(tx, mediaId, userId);
      if (media.status !== 'UPLOADING') throw new BadRequestException('当前媒体状态不能重新上传');
      await this.assertSlot(tx, userId, now, mediaId);
      return tx.media.update({ where: { id: mediaId }, data: { audioInputBytes: media.audioInputBytes ?? media.size, audioUploadLeaseUntil: new Date(now.getTime() + AUDIO_UPLOAD_LEASE_MS) } });
    });
  }

  async startProcessing(mediaId: string, userId: string, size: number, contentType: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const media = await this.lockedMedia(tx, mediaId, userId);
      if (media.status === 'PROCESSING' || media.status === 'COMPLETED') return { media, claimed: false };
      if (media.status !== 'UPLOADING') throw new BadRequestException('无效的上传状态');
      await this.assertSlot(tx, userId, now, mediaId);
      const updated = await tx.media.update({ where: { id: mediaId }, data: { status: 'PROCESSING', processingStartedAt: now, size, contentType, audioInputBytes: media.audioInputBytes ?? size, audioUploadLeaseUntil: new Date(now.getTime() + AUDIO_UPLOAD_LEASE_MS) } });
      return { media: updated, claimed: true };
    });
  }
}
