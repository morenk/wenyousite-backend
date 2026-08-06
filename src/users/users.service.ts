import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { DEACTIVATED_USER_NAME } from '../common/user-summary';

const userSelectPrivate = {
  id: true, email: true, username: true, avatar: true, bio: true,
  role: true, showRecentReplies: true, showPlayerBadges: true, showBookmarks: true,
  emailVerified: true, deletedAt: true, createdAt: true, updatedAt: true,
};

const userSelectPublic = {
  id: true, username: true, avatar: true, bio: true, role: true,
  showRecentReplies: true, showPlayerBadges: true, showBookmarks: true,
  deletedAt: true, createdAt: true,
};

const maskDeactivated = (user: Record<string, any>) => {
  if (!user.deletedAt) {
    const { deletedAt, ...rest } = user;
    return rest;
  }
  return { id: user.id, username: DEACTIVATED_USER_NAME, isDeactivated: true };
};

/** 用户服务：用户资料查询与更新 */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private cache: CacheService,
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
    return user;
  }

  async findById(id: string, viewerId?: string) {
    // 无登录态 viewer → 尝试缓存命中
    if (!viewerId) {
      const cacheKey = this.cache.buildKey('user', id);
      const cached = await this.cache.get<any>(cacheKey);
      if (cached) return cached;

      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { ...userSelectPublic, _count: { select: { following: true, followers: true } } },
      });
      if (!user) throw new NotFoundException('用户不存在');
      const masked = maskDeactivated(user);
      this.cache.set(cacheKey, masked, 300000).catch(() => {}); // 5 min
      return masked;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userSelectPublic,
        _count: { select: { following: true, followers: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const masked = maskDeactivated(user);

    if ((masked as any).isDeactivated) return masked;

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

    if (dto.username && dto.username !== user.username) {
      if (user.lastUsernameChange) {
        const cooldownEnd = new Date(user.lastUsernameChange.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (new Date() < cooldownEnd) {
          const remaining = Math.ceil((cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          throw new BadRequestException(`用户名修改后需间隔 7 天，剩余 ${remaining} 天`);
        }
      }
      const existing = await this.findByUsername(dto.username);
      if (existing) throw new ConflictException('用户名已被占用');
    }

    // 空 body 不执行 DB 写
    if (Object.keys(dto).length === 0) {
      const currentUser = await this.prisma.user.findUnique({
        where: { id },
        select: userSelectPrivate,
      });
      return currentUser!;
    }

    try {
      const result = await this.prisma.user.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.username && dto.username !== user.username ? { lastUsernameChange: new Date() } : {}),
        },
        select: userSelectPrivate,
      });
      this.eventEmitter.emit('user.updated', { userId: id });
      return result;
    } catch (e: any) {
      if (e.code === 'P2002') {
        // findByUsername 与 DB 写之间的竞态
        const target = e.meta?.target as string[] | undefined;
        if (target?.includes('username')) {
          throw new ConflictException('用户名已被占用');
        }
      }
      throw e;
    }
  }

  /** 设置/移除头像：mediaId 传入校验归属 + COMPLETED 后写入 user.avatar；传 null 清除头像 */
  async setAvatar(userId: string, mediaId: string | null) {
    // mediaId 为 null 表示清除头像
    if (mediaId === null) {
      return this.prisma.user.update({
        where: { id: userId },
        data: { avatar: null },
        select: userSelectPrivate,
      }).then((result) => {
        this.eventEmitter.emit('user.updated', { userId });
        return result;
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
      throw new BadRequestException(`图片尚未处理完成（当前状态: ${media.status}），请稍后重试或查询 GET /media/${media.id}`);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar: media.url },
      select: userSelectPrivate,
    }).then((result) => {
      this.eventEmitter.emit('user.updated', { userId });
      return result;
    });
  }

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.deletedAt) throw new NotFoundException('用户不存在');

    // 释放唯一键同时移除原始账号标识；内部墓碑值不得用于对外展示。
    const tombstone = user.id.slice(-16);
    const releasedUsername = `deleted_${tombstone}`;
    const releasedEmail = `deleted_${user.id}@deleted.invalid`;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          username: releasedUsername,
          email: releasedEmail,
          avatar: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.eventEmitter.emit('user.deleted', { userId: id, avatarUrl: user.avatar });
    return { message: '账号已注销' };
  }
}
