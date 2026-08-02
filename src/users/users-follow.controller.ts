import { Controller, Post, Delete, Get, Param, Req, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { BlockFilterService } from '../common/services/block-filter.service';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';

/** 关注与拉黑控制器 */
@ApiTags('Users')
@Controller('users')
export class UsersFollowController {
  constructor(
    private prisma: PrismaService,
    private notificationProducer: NotificationProducer,
    private blockFilter: BlockFilterService,
  ) {}

  // ====== 关注 ======

  /** 关注指定用户，仅在首次关注时发送通知 */
  @Post('follow/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '关注用户' })
  @ApiOkResponse({ description: '关注结果（成功 / 已关注 / 不能关注自己）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '目标用户不存在' })
  async follow(@Param('id') targetId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string; username: string };
    if (user.id === targetId) return { message: '不能关注自己' };

    // 检查是否已关注，仅在首次关注时发送通知，避免重复通知
    const existing = await this.prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId: user.id, followingId: targetId } },
    });
    if (existing) return { message: '已关注' };

    await this.prisma.userFollow.create({
      data: { followerId: user.id, followingId: targetId },
    });

    // 关注通知：排除拉黑关系
    const blockSets = await this.blockFilter.loadBlockSets(user.id);
    const filtered = this.blockFilter.filterRecipients([targetId], blockSets);
    if (filtered.length > 0) {
      this.notificationProducer.notify(
        'follow',
        [targetId],
        `${user.username ?? '有人'} 关注了你`,
        { fromUserId: user.id },
      ).catch(() => {});
    }
    return { message: '已关注' };
  }

  /** 取消关注 */
  @Delete('follow/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消关注' })
  @ApiOkResponse({ description: '已取消关注' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '目标用户不存在' })
  async unfollow(@Param('id') targetId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.prisma.userFollow.deleteMany({
      where: { followerId: user.id, followingId: targetId },
    });
    return { message: '已取消关注' };
  }

  /** 我的关注列表 */
  @Get('following')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的关注列表' })
  @ApiOkResponse({ description: '我的关注用户列表（含 id/username/avatar）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async following(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.prisma.userFollow.findMany({
      where: { followerId: user.id },
      include: { following: { select: { id: true, username: true, avatar: true } } },
    });
  }

  /** 我的粉丝列表 */
  @Get('followers')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的粉丝列表' })
  @ApiOkResponse({ description: '我的粉丝列表（含 id/username/avatar）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async followers(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.prisma.userFollow.findMany({
      where: { followingId: user.id },
      include: { follower: { select: { id: true, username: true, avatar: true } } },
    });
  }

  // ====== 公开关注/粉丝列表（按用户 ID） ======

  /** 指定用户的关注列表（公开，OptionalAuth） */
  @Get(':id/following')
  @OptionalAuth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '指定用户的关注列表' })
  @ApiOkResponse({ description: '指定用户的关注列表（含 id/username/avatar）' })
  @ApiNotFoundResponse({ description: '用户不存在' })
  async userFollowing(@Param('id') id: string) {
    await this.assertUserExists(id);
    return this.prisma.userFollow.findMany({
      where: { followerId: id },
      include: { following: { select: { id: true, username: true, avatar: true } } },
    });
  }

  /** 指定用户的粉丝列表（公开，OptionalAuth） */
  @Get(':id/followers')
  @OptionalAuth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '指定用户的粉丝列表' })
  @ApiOkResponse({ description: '指定用户的粉丝列表（含 id/username/avatar）' })
  @ApiNotFoundResponse({ description: '用户不存在' })
  async userFollowers(@Param('id') id: string) {
    await this.assertUserExists(id);
    return this.prisma.userFollow.findMany({
      where: { followingId: id },
      include: { follower: { select: { id: true, username: true, avatar: true } } },
    });
  }

  private async assertUserExists(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
  }

  // ====== 拉黑 ======

  /** 拉黑指定用户（双向阻止发帖 + 通知） */
  @Post('me/block/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '拉黑用户' })
  @ApiOkResponse({ description: '拉黑结果（成功 / 不能拉黑自己）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '目标用户不存在' })
  async block(@Param('id') targetId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    if (user.id === targetId) return { message: '不能拉黑自己' };
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: targetId } },
      create: { blockerId: user.id, blockedId: targetId },
      update: {},
    });
    return { message: '已拉黑' };
  }

  /** 取消拉黑 */
  @Delete('me/block/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消拉黑' })
  @ApiOkResponse({ description: '已取消拉黑' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async unblock(@Param('id') targetId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: user.id, blockedId: targetId },
    });
    return { message: '已取消拉黑' };
  }

  /** 我的黑名单 */
  @Get('me/blocks')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的黑名单' })
  @ApiOkResponse({ description: '我的黑名单列表（含 id/username/avatar）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async blocks(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.prisma.userBlock.findMany({
      where: { blockerId: user.id },
      include: { blocked: { select: { id: true, username: true, avatar: true } } },
    });
  }
}
