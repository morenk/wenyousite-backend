import { Controller, Get, Patch, Delete, Body, Param, Query, Req, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiOkResponse, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiConflictResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetAvatarDto } from './dto/set-avatar.dto';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { ThreadsService } from '../threads/threads.service';
import { truncateMarkdown } from '../common/markdown-truncate';

/** 用户控制器：查询和修改个人资料 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
    private bookmarksService: BookmarksService,
    private threadsService: ThreadsService,
  ) {}

  @Get('search')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '搜索用户（@提及用）' })
  @ApiQuery({ name: 'q', description: '用户名搜索关键词' })
  @ApiOkResponse({ description: '匹配的用户列表（最多 10 条），含 id/username/avatar' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
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
  @ApiOkResponse({ description: '含 email / 隐私设置 / _count.following / _count.followers' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async getMe(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.usersService.findMe(user.id);
  }

  @Patch('me')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前登录用户资料（5 次/分钟）' })
  @ApiOkResponse({ description: '更新后的用户资料' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiConflictResponse({ description: '用户名已被占用' })
  async updateMe(@Req() req: FastifyRequest, @Body() dto: UpdateUserDto) {
    const user = req['user'] as { id: string };
    return this.usersService.update(user.id, dto);
  }

  @Patch('me/avatar')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '设置头像（传入 mediaId，校验归属和 COMPLETED 状态）' })
  @ApiOkResponse({ description: '更新后的用户资料（含新头像）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: 'mediaId 不存在或未完成处理' })
  async setAvatar(@Req() req: FastifyRequest, @Body() dto: SetAvatarDto) {
    const user = req['user'] as { id: string };
    return this.usersService.setAvatar(user.id, dto.mediaId);
  }

  @Delete('me')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '注销当前账号' })
  @ApiOkResponse({ description: '账号已注销' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async deleteMe(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.usersService.deactivate(user.id);
  }

  @Get(':id/bookmarks')
  @OptionalAuth()
  @ApiOperation({ summary: '查看用户的收藏列表（受 showBookmarks 隐私开关控制）' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标（上一页最后一条记录 ID）' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数（默认 20，最大 50）' })
  @ApiOkResponse({ description: '用户的收藏列表（cursor 分页，含帖子摘要）' })
  @ApiNotFoundResponse({ description: '用户不存在或未公开收藏' })
  async getUserBookmarks(
    @Param('id') id: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const viewer = req['user'] as { id: string } | undefined;
    return this.bookmarksService.findByUserId(id, viewer?.id, cursor, limit ? parseInt(limit) : undefined);
  }

  @Get(':id/played-threads')
  @OptionalAuth()
  @ApiOperation({ summary: '查看用户参与的帖子（被标记为玩家，受 showPlayerBadges 隐私开关控制）' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标（上一页最后一条记录 ID）' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数（默认 20，最大 50）' })
  @ApiOkResponse({ description: '用户参与的帖子列表（cursor 分页）' })
  @ApiNotFoundResponse({ description: '用户不存在或未公开参与的帖子' })
  async getUserPlayedThreads(
    @Param('id') id: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const viewer = req['user'] as { id: string } | undefined;

    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, showPlayerBadges: true },
    });
    if (!targetUser) throw new NotFoundException('用户不存在');
    if (!targetUser.showPlayerBadges && targetUser.id !== viewer?.id) {
      throw new NotFoundException('该用户未公开参与的帖子');
    }

    return this.threadsService.findByPlayedUser(id, viewer?.id, cursor, limit ? parseInt(limit) : undefined);
  }

  @Get(':id/recent-replies')
  @OptionalAuth()
  @ApiOperation({ summary: '查看用户最近 10 条回复（受 showRecentReplies 隐私开关控制）' })
  @ApiOkResponse({ description: '用户最近 10 条回复（含预览截断、所属帖子/子贴信息）' })
  @ApiNotFoundResponse({ description: '用户不存在或未公开最近动态' })
  async getUserRecentReplies(@Param('id') id: string, @Req() req: FastifyRequest) {
    const viewer = req['user'] as { id: string } | undefined;

    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, showRecentReplies: true },
    });
    if (!targetUser) throw new NotFoundException('用户不存在');
    if (!targetUser.showRecentReplies && targetUser.id !== viewer?.id) {
      throw new NotFoundException('该用户未公开最近动态');
    }

    const isSelf = viewer?.id === id;
    const replies = await this.prisma.post.findMany({
      where: {
        authorId: id,
        deletedAt: null,
        subthread: { deletedAt: null },
        thread: {
          published: true,
          deletedAt: null,
          ...(isSelf ? {} : { visibility: 'PUBLIC' }),
        },
      },
      select: {
        id: true,
        createdAt: true,
        floorNumber: true,
        parentPostId: true,
        content: true,
        threadId: true,
        thread: { select: { title: true } },
        subthreadId: true,
        subthread: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return replies.map((r) => ({
      ...r,
      preview: truncateMarkdown(r.content),
    }));
  }

  @Get(':id')
  @OptionalAuth()
  @ApiOperation({ summary: '获取指定用户的公开资料。登录后额外返回关注/拉黑关系' })
  @ApiOkResponse({ description: '公开资料。登录后附加 isFollowing/isFollowedBy/isBlocked/isBlockedBy' })
  @ApiNotFoundResponse({ description: '用户不存在' })
  async getUser(@Param('id') id: string, @Req() req: FastifyRequest) {
    const viewer = req['user'] as { id: string } | undefined;
    return this.usersService.findById(id, viewer?.id);
  }
}
