import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { CacheService } from '../redis/cache.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { DEACTIVATED_USER_NAME } from '../common/user-summary';
import { progressionFor } from '../progression/progression.constants';
import { UserSanctionType } from '@prisma/client';
import { activeSanctionWhere } from '../auth/account-sanction';
import { mediaVariantUrls } from '../media/media-response.mapper';

const profileCoverMediaSelect = {
  id: true,
  url: true,
  status: true,
  contentType: true,
  width: true,
  height: true,
} as const;

const userSelectPrivate = {
  id: true,
  email: true,
  username: true,
  avatar: true,
  profileCoverMedia: { select: profileCoverMediaSelect },
  profileCoverMobileMedia: { select: profileCoverMediaSelect },
  bio: true,
  role: true,
  showRecentReplies: true,
  showPlayerBadges: true,
  showBookmarks: true,
  deletedAt: true,
  experience: true,
  level: true,
  createdAt: true,
  updatedAt: true,
  wallet: { select: { receivedTipTotal: true, receivedTipCount: true } },
};

const userSelectPublic = () => ({
  id: true,
  username: true,
  avatar: true,
  profileCoverMedia: { select: profileCoverMediaSelect },
  profileCoverMobileMedia: { select: profileCoverMediaSelect },
  bio: true,
  role: true,
  showRecentReplies: true,
  showPlayerBadges: true,
  showBookmarks: true,
  deletedAt: true,
  level: true,
  createdAt: true,
  wallet: { select: { receivedTipTotal: true, receivedTipCount: true } },
  sanctions: {
    where: activeSanctionWhere(),
    select: { type: true, endsAt: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
});

const USER_WRITE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

interface UserWithProgressAndTips extends Record<string, unknown> {
  id: string;
  deletedAt?: Date | null;
  experience?: number;
  wallet?: {
    receivedTipTotal: bigint;
    receivedTipCount: number;
  } | null;
  profileCoverMedia?: {
    id: string;
    url: string;
    status: string;
    contentType: string | null;
    width: number | null;
    height: number | null;
  } | null;
  profileCoverMobileMedia?: {
    id: string;
    url: string;
    status: string;
    contentType: string | null;
    width: number | null;
    height: number | null;
  } | null;
  sanctions?: Array<{
    type: UserSanctionType;
    endsAt: Date | null;
  }>;
}

const flattenProgressAndTips = (user: UserWithProgressAndTips): Record<string, unknown> => {
  const { wallet, profileCoverMedia, profileCoverMobileMedia, ...fields } = user;
  return {
    ...fields,
    profileCover: profileCoverMedia
      ? {
          url: profileCoverMedia.url,
          mediumUrl: mediaVariantUrls(profileCoverMedia).mediumUrl,
          width: profileCoverMedia.width,
          height: profileCoverMedia.height,
          mobile: profileCoverMobileMedia
            ? {
                url: profileCoverMobileMedia.url,
                mediumUrl: mediaVariantUrls(profileCoverMobileMedia).mediumUrl,
                width: profileCoverMobileMedia.width,
                height: profileCoverMobileMedia.height,
              }
            : null,
        }
      : null,
    ...(typeof fields.experience === 'number' ? progressionFor(fields.experience) : {}),
    receivedTipTotal: (wallet?.receivedTipTotal ?? 0n).toString(),
    receivedTipCount: wallet?.receivedTipCount ?? 0,
  };
};

const maskDeactivated = (user: UserWithProgressAndTips): Record<string, unknown> => {
  if (!user.deletedAt) {
    const { sanctions, ...rest } = user;
    delete rest.deletedAt;
    const type = sanctions?.[0]?.type;
    return {
      ...flattenProgressAndTips(rest),
      accountStatus:
        type === UserSanctionType.BAN
          ? 'BANNED'
          : type === UserSanctionType.SUSPENSION
            ? 'SUSPENDED'
            : 'ACTIVE',
    };
  }
  return { id: user.id, username: DEACTIVATED_USER_NAME, isDeactivated: true };
};

const publicProfileCacheTtl = (user: UserWithProgressAndTips): number => {
  const endsAt = user.sanctions?.[0]?.endsAt;
  if (!endsAt) return 300_000;
  return Math.max(1_000, Math.min(300_000, endsAt.getTime() - Date.now()));
};

/** 用户服务：用户资料查询与更新 */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private cache: CacheService,
    private mediaReferences: MediaReferenceService,
  ) {}

  /** 获取本人完整资料（含 email、社交统计） */
  async findMe(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userSelectPrivate,
        _count: { select: { following: true, followers: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');
    return flattenProgressAndTips(user);
  }

  async findById(id: string, viewerId?: string) {
    // 无登录态 viewer → 尝试缓存命中
    if (!viewerId) {
      const cacheKey = this.cache.buildKey('user', id);
      const cached = await this.cache.get<Record<string, unknown>>(cacheKey);
      if (cached) return cached;

      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { ...userSelectPublic(), _count: { select: { following: true, followers: true } } },
      });
      if (!user) throw new NotFoundException('用户不存在');
      const masked = maskDeactivated(user);
      this.cache.set(cacheKey, masked, publicProfileCacheTtl(user)).catch(() => {});
      return masked;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userSelectPublic(),
        _count: { select: { following: true, followers: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const masked = maskDeactivated(user);

    if (masked.isDeactivated === true) return masked;

    const [following, follower, blocked, blockedBy] = await Promise.all([
      this.prisma.userFollow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: id } },
      }),
      this.prisma.userFollow.findUnique({
        where: { followerId_followingId: { followerId: id, followingId: viewerId } },
      }),
      this.prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId: viewerId, blockedId: id } },
      }),
      this.prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId: id, blockedId: viewerId } },
      }),
    ]);

    return {
      ...masked,
      isFollowing: !!following,
      isFollowedBy: !!follower,
      isBlocked: !!blocked,
      isBlockedBy: !!blockedBy,
    };
  }

  /** 根据邮箱查找用户（内部使用，包含密码字段） */
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** 根据用户名查找未注销用户 */
  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username, deletedAt: null },
    });
  }

  /** 更新用户资料：校验唯一性、冷却期、捕获竞态、空 body 短路 */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');

    // 空 body 不执行 DB 写
    if (Object.keys(dto).length === 0) {
      const currentUser = await this.prisma.user.findUnique({
        where: { id },
        select: userSelectPrivate,
      });
      return flattenProgressAndTips(currentUser!);
    }

    try {
      // 只要请求携带 username 就进入同一用户行锁。否则“客户端认为名称未变”的
      // 过期资料请求可能在并发改名提交后把旧名称写回，并绕过 7 天冷却。
      const usernameTouched = dto.username !== undefined;
      const result = usernameTouched
        ? await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
            const current = await tx.user.findUnique({ where: { id } });
            if (!current) throw new NotFoundException('用户不存在');

            const changingCurrentName = dto.username !== current.username;
            if (changingCurrentName && current.lastUsernameChange) {
              const cooldownEnd = new Date(
                current.lastUsernameChange.getTime() + 7 * 24 * 60 * 60 * 1000,
              );
              if (new Date() < cooldownEnd) {
                const remaining = Math.ceil(
                  (cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
                );
                throw new BadRequestException(`用户名修改后需间隔 7 天，剩余 ${remaining} 天`);
              }
            }
            if (changingCurrentName) {
              const existing = await tx.user.findUnique({
                where: { username: dto.username!, deletedAt: null },
                select: { id: true },
              });
              if (existing && existing.id !== id) throw new ConflictException('用户名已被占用');
            }

            return tx.user.update({
              where: { id },
              data: {
                ...dto,
                ...(changingCurrentName ? { lastUsernameChange: new Date() } : {}),
              },
              select: userSelectPrivate,
            });
          }, USER_WRITE_TRANSACTION_OPTIONS)
        : await this.prisma.user.update({
            where: { id },
            data: dto,
            select: userSelectPrivate,
          });
      this.eventEmitter.emit('user.updated', { userId: id });
      return flattenProgressAndTips(result);
    } catch (error: unknown) {
      const prismaError = error as { code?: string; meta?: { target?: unknown } };
      if (prismaError.code === 'P2002') {
        // findByUsername 与 DB 写之间的竞态
        const target = prismaError.meta?.target as string[] | undefined;
        if (target?.includes('username')) {
          throw new ConflictException('用户名已被占用');
        }
      }
      throw error;
    }
  }

  /** 设置/移除头像：mediaId 传入校验归属 + COMPLETED 后写入 user.avatar；传 null 清除头像 */
  async setAvatar(userId: string, mediaId: string | null) {
    // mediaId 为 null 表示清除头像
    if (mediaId === null) {
      return this.prisma
        .$transaction(async (tx) => {
          const current = await tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { avatarMediaId: true },
          });
          const result = await tx.user.update({
            where: { id: userId },
            data: { avatar: null, avatarMediaId: null },
            select: userSelectPrivate,
          });
          await this.mediaReferences.reconcileMediaIds(
            tx,
            current.avatarMediaId ? [current.avatarMediaId] : [],
          );
          return result;
        })
        .then((result) => {
          this.eventEmitter.emit('user.updated', { userId });
          return flattenProgressAndTips(result);
        });
    }

    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('媒体记录不存在');
    }
    if (media.userId !== userId) {
      throw new ForbiddenException('无权使用此图片');
    }
    if (media.status !== 'COMPLETED') {
      throw new BadRequestException(
        `图片尚未处理完成（当前状态: ${media.status}），请稍后重试或查询 GET /media/${media.id}`,
      );
    }

    return this.prisma
      .$transaction(async (tx) => {
        const current = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { avatarMediaId: true },
        });
        const result = await tx.user.update({
          where: { id: userId },
          data: { avatar: media.url, avatarMediaId: media.id },
          select: userSelectPrivate,
        });
        await this.mediaReferences.reconcileMediaIds(
          tx,
          [current.avatarMediaId, media.id].filter((id): id is string => Boolean(id)),
        );
        return result;
      })
      .then((result) => {
        this.eventEmitter.emit('user.updated', { userId });
        return flattenProgressAndTips(result);
      });
  }

  /** 绑定/移除个人主页双画幅背景图；电脑端为 3:1，移动端为 2:1。 */
  async setProfileCover(userId: string, mediaId: string | null, mobileMediaId?: string | null) {
    if (mediaId === null) {
      const result = await this.prisma.$transaction(async (tx) => {
        const current = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { profileCoverMediaId: true, profileCoverMobileMediaId: true },
        });
        const updated = await tx.user.update({
          where: { id: userId },
          data: { profileCoverMediaId: null, profileCoverMobileMediaId: null },
          select: userSelectPrivate,
        });
        await this.mediaReferences.reconcileMediaIds(
          tx,
          [current.profileCoverMediaId, current.profileCoverMobileMediaId].filter(
            (id): id is string => Boolean(id),
          ),
        );
        return updated;
      });
      this.eventEmitter.emit('user.updated', { userId });
      return flattenProgressAndTips(result);
    }

    const webMedia = await this.validateProfileCoverMedia(userId, mediaId, 3, '电脑端');
    const mobileMedia = mobileMediaId
      ? await this.validateProfileCoverMedia(userId, mobileMediaId, 2, '移动端')
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { profileCoverMediaId: true, profileCoverMobileMediaId: true },
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          profileCoverMediaId: webMedia.id,
          profileCoverMobileMediaId: mobileMedia?.id ?? null,
        },
        select: userSelectPrivate,
      });
      await this.mediaReferences.reconcileMediaIds(
        tx,
        [
          current.profileCoverMediaId,
          current.profileCoverMobileMediaId,
          webMedia.id,
          mobileMedia?.id,
        ].filter((id): id is string => Boolean(id)),
      );
      return updated;
    });
    this.eventEmitter.emit('user.updated', { userId });
    return flattenProgressAndTips(result);
  }

  private async validateProfileCoverMedia(
    userId: string,
    mediaId: string,
    expectedRatio: 2 | 3,
    surfaceLabel: '电脑端' | '移动端',
  ) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException(`${surfaceLabel}背景媒体记录不存在`);
    if (media.userId !== userId) throw new ForbiddenException(`无权使用此${surfaceLabel}背景`);
    if (media.status !== 'COMPLETED') {
      throw new BadRequestException(
        `${surfaceLabel}背景尚未处理完成（当前状态: ${media.status}），请稍后重试或查询 GET /media/${media.id}`,
      );
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(media.contentType ?? '')) {
      throw new BadRequestException(`${surfaceLabel}背景仅支持 jpg/png/webp 格式`);
    }
    const tolerance = expectedRatio * 0.01;
    if (
      !media.width ||
      !media.height ||
      Math.abs(media.width / media.height - expectedRatio) > tolerance
    ) {
      throw new BadRequestException(`${surfaceLabel}背景必须裁剪为 ${expectedRatio}:1`);
    }
    return media;
  }

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.deletedAt) throw new NotFoundException('用户不存在');

    // 释放唯一键同时移除原始账号标识；内部墓碑值不得用于对外展示。
    const tombstone = user.id.slice(-16);
    const releasedUsername = `deleted_${tombstone}`;
    const releasedEmail = `deleted_${user.id}@deleted.invalid`;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          username: releasedUsername,
          email: releasedEmail,
          avatar: null,
          avatarMediaId: null,
          profileCoverMediaId: null,
          profileCoverMobileMediaId: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.mediaReferences.reconcileMediaIds(
        tx,
        [user.avatarMediaId, user.profileCoverMediaId, user.profileCoverMobileMediaId].filter(
          (mediaId): mediaId is string => Boolean(mediaId),
        ),
      );
    });
    this.eventEmitter.emit('user.deleted', { userId: id, avatarUrl: user.avatar });
    return { message: '账号已注销' };
  }
}
