import { Controller, Get, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetAvatarDto } from './dto/set-avatar.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** 用户控制器：查询和修改个人资料 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService, private prisma: PrismaService) {}

  @Get('search')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '搜索用户（@提及用）' })
  @ApiQuery({ name: 'q', description: '用户名搜索关键词' })
  async search(@Query('q') q: string) {
    if (!q || q.length < 1) return [];
    return this.prisma.user.findMany({
      where: { username: { contains: q, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, username: true, avatar: true },
      take: 10,
      orderBy: { username: 'asc' },
    });
  }

  @Get('me')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户资料' })
  async getMe(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.usersService.findMe(user.id);
  }

  @Patch('me')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前登录用户资料（5 次/分钟）' })
  async updateMe(@Req() req: FastifyRequest, @Body() dto: UpdateUserDto) {
    const user = req['user'] as { id: string };
    return this.usersService.update(user.id, dto);
  }

  @Patch('me/avatar')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '设置头像（传入 mediaId，校验归属和 COMPLETED 状态）' })
  async setAvatar(@Req() req: FastifyRequest, @Body() dto: SetAvatarDto) {
    const user = req['user'] as { id: string };
    return this.usersService.setAvatar(user.id, dto.mediaId);
  }

  @Delete('me')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '注销当前账号' })
  async deleteMe(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.usersService.deactivate(user.id);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '根据用户 ID 获取公开资料' })
  async getUser(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
