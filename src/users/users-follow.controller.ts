import { Controller, Post, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Users')
@Controller('users')
export class UsersFollowController {
  constructor(private prisma: PrismaService) {}

  @Post('follow/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '关注用户' })
  async follow(@Param('id') targetId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    if (user.id === targetId) return { message: '不能关注自己' };
    await this.prisma.userFollow.upsert({
      where: { followerId_followingId: { followerId: user.id, followingId: targetId } },
      create: { followerId: user.id, followingId: targetId },
      update: {},
    });
    return { message: '已关注' };
  }

  @Delete('follow/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消关注' })
  async unfollow(@Param('id') targetId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.prisma.userFollow.deleteMany({
      where: { followerId: user.id, followingId: targetId },
    });
    return { message: '已取消关注' };
  }

  @Get('following')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的关注列表' })
  async following(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.prisma.userFollow.findMany({
      where: { followerId: user.id },
      include: { following: { select: { id: true, username: true, nickname: true, avatar: true } } },
    });
  }

  @Get('followers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的粉丝列表' })
  async followers(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.prisma.userFollow.findMany({
      where: { followingId: user.id },
      include: { follower: { select: { id: true, username: true, nickname: true, avatar: true } } },
    });
  }
}
