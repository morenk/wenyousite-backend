import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

const userSelect = {
  id: true, email: true, username: true, nickname: true, avatar: true, bio: true,
  role: true, showRecentReplies: true, showPlayerBadges: true, showBookmarks: true,
  emailVerified: true, deletedAt: true, createdAt: true, updatedAt: true,
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
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw new NotFoundException('用户不存在');
    return maskDeactivated(user);
  }

  /** 根据邮箱查找用户（内部使用，包含密码字段） */
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** 根据用户名查找用户（内部使用，包含密码字段） */
  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  /** 更新用户资料：如果修改用户名，检查唯一性 */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');

    if (dto.username && dto.username !== user.username) {
      const existing = await this.findByUsername(dto.username);
      if (existing) throw new ConflictException('用户名已被占用');
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: userSelect,
    });
  }

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.deletedAt) throw new NotFoundException('用户不存在');

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { message: '账号已注销' };
  }
}
