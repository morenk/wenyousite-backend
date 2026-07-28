import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

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
  if (!user.deletedAt) return user;
  return { id: user.id, username: '已注销用户', deletedAt: user.deletedAt, isDeactivated: true };
};

/** 用户服务：用户资料查询与更新 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** 根据用户 ID 查找用户 */
  async findMe(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelectPrivate });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelectPublic });
    if (!user) throw new NotFoundException('用户不存在');
    return maskDeactivated(user);
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
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.username && dto.username !== user.username ? { lastUsernameChange: new Date() } : {}),
        },
        select: userSelectPrivate,
      });
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

  /** 设置头像：校验 media 归属 + COMPLETED 状态后写入 user.avatar */
  async setAvatar(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('媒体记录不存在');
    }
    if (media.userId !== userId) {
      throw new ForbiddenException('无权使用此图片');
    }
    if (media.status !== 'COMPLETED') {
      throw new BadRequestException('图片尚未处理完成');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar: media.url },
      select: userSelectPrivate,
    });
  }

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.deletedAt) throw new NotFoundException('用户不存在');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: '账号已注销' };
  }
}
