import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetAvatarDto } from './dto/set-avatar.dto';
import { SetProfileCoverDto } from './dto/set-profile-cover.dto';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { MentionCandidatesResponseDto } from './dto/mention-candidate.dto';
import { PlayedThreadsQueryDto } from './dto/played-threads-query.dto';
import { UserActivityService } from './user-activity.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import {
  BookmarkThreadResponseDto,
  ThreadListItemResponseDto,
} from '../threads/dto/thread-list-response.dto';
import {
  CurrentUserResponseDto,
  PrivateUserResponseDto,
  PublicUserResponseDto,
  RecentReplyResponseDto,
  UserActivitySummaryResponseDto,
} from './dto/user-response.dto';
import { PostAuthorResponseDto } from '../posts/dto/post-response.dto';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';

/** 用户控制器：查询和修改个人资料 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private activity: UserActivityService,
  ) {}

  @Get('search')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '搜索用户（@提及用）' })
  @ApiQuery({ name: 'q', description: '用户名搜索关键词' })
  @ApiOkResponse({ type: PostAuthorResponseDto, isArray: true, description: '匹配的用户列表（最多 10 条），含 id/username/avatar' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async search(@Query('q') q: string) {
    return this.activity.searchUsers(q);
  }

  @Get('mention-candidates')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前主题帖可艾特候选（关注的人 + 帖内标记玩家）' })
  @ApiQuery({ name: 'threadId', required: true, description: '主题帖 ID' })
  @ApiQuery({ name: 'q', required: false, type: String, description: '用户名搜索关键词' })
  @ApiOkResponse({
    type: MentionCandidatesResponseDto,
    description: '最多返回 20 个可艾特用户，并返回是否允许 @全体玩家',
  })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async mentionCandidates(
    @Query('threadId') threadId: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.activity.mentionCandidates(threadId, user.id, q);
  }

  @Get('me')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户资料' })
  @ApiOkResponse({ type: CurrentUserResponseDto, description: '含 email / 隐私设置 / _count.following / _count.followers' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async getMe(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.findMe(user.id);
  }

  @Patch('me')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前登录用户资料（5 次/分钟）' })
  @ApiOkResponse({ type: PrivateUserResponseDto, description: '更新后的用户资料' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiConflictResponse({ description: '用户名已被占用' })
  async updateMe(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.id, dto);
  }

  @Patch('me/avatar')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '设置头像（传入 mediaId，校验归属和 COMPLETED 状态）' })
  @ApiOkResponse({ type: PrivateUserResponseDto, description: '更新后的用户资料（含新头像）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: 'mediaId 不存在或未完成处理' })
  async setAvatar(@CurrentUser() user: CurrentUserPayload, @Body() dto: SetAvatarDto) {
    return this.usersService.setAvatar(user.id, dto.mediaId);
  }

  @Delete('me/avatar')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移除头像（置空 user.avatar，回到首字母占位）' })
  @ApiOkResponse({ type: PrivateUserResponseDto, description: '更新后的用户资料（avatar 为 null）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async removeAvatar(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.setAvatar(user.id, null);
  }

  @Patch('me/profile-cover')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '设置个人主页背景图（传入 3:1 图片的 mediaId）' })
  @ApiOkResponse({
    type: PrivateUserResponseDto,
    description: '更新后的用户资料（含新背景图）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: 'mediaId 不存在或未完成处理' })
  async setProfileCover(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SetProfileCoverDto,
  ) {
    return this.usersService.setProfileCover(user.id, dto.mediaId);
  }

  @Delete('me/profile-cover')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移除个人主页背景图并恢复默认背景' })
  @ApiOkResponse({
    type: PrivateUserResponseDto,
    description: '更新后的用户资料（profileCover 为 null）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async removeProfileCover(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.setProfileCover(user.id, null);
  }

  @Delete('me')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '注销当前账号' })
  @ApiOkResponse({ type: MessageResponseDto, description: '账号已注销' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async deleteMe(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.deactivate(user.id);
  }

  @Get(':id/bookmarks')
  @OptionalAuth()
  @ApiOperation({ summary: '查看用户的收藏列表（受 showBookmarks 隐私开关控制）' })
  @ApiCursorPaginatedResponse(BookmarkThreadResponseDto, '用户的收藏列表（cursor 分页，含帖子摘要）')
  @ApiNotFoundResponse({ description: '用户不存在或未公开收藏' })
  async getUserBookmarks(
    @Param('id') id: string,
    @Query() query: CursorPaginationDto,
    @CurrentUser() viewer: CurrentUserPayload | undefined,
  ) {
    return this.activity.userBookmarks(
      id,
      viewer?.id,
      query.cursor,
      query.limit,
    );
  }

  @Get(':id/played-threads')
  @OptionalAuth()
  @ApiOperation({ summary: '查看用户参与的帖子（仅已被授予玩家身份的帖子；他人仅可见公开帖）' })
  @ApiCursorPaginatedResponse(ThreadListItemResponseDto, '用户参与的帖子列表（cursor 分页）')
  @ApiNotFoundResponse({ description: '用户不存在或未公开参与的帖子' })
  async getUserPlayedThreads(
    @Param('id') id: string,
    @Query() query: PlayedThreadsQueryDto,
    @CurrentUser() viewer: CurrentUserPayload | undefined,
  ) {
    return this.activity.playedThreads({
      targetId: id,
      viewerId: viewer?.id,
      cursor: query.cursor,
      limit: query.limit,
      visibility: query.visibility,
    });
  }

  @Get(':id/created-threads')
  @OptionalAuth()
  @ApiOperation({
    summary: '查看用户创建的主题帖（本人可见全部含私密帖，他人仅见 PUBLIC 已发布帖）',
  })
  @ApiCursorPaginatedResponse(ThreadListItemResponseDto, '用户创建的主题帖列表（cursor 分页）')
  @ApiNotFoundResponse({ description: '用户不存在' })
  async getUserCreatedThreads(
    @Param('id') id: string,
    @Query() query: CursorPaginationDto,
    @CurrentUser() viewer: CurrentUserPayload | undefined,
  ) {
    return this.activity.createdThreads(
      id,
      viewer?.id,
      query.cursor,
      query.limit,
    );
  }

  @Get(':id/activity-summary')
  @OptionalAuth()
  @ApiOperation({ summary: '获取用户主页创作活动汇总' })
  @ApiOkResponse({
    type: UserActivitySummaryResponseDto,
    description: '按当前查看者权限统计动态、创建主题、参与主题和回复总数',
  })
  @ApiNotFoundResponse({ description: '用户不存在' })
  async getUserActivitySummary(
    @Param('id') id: string,
    @CurrentUser() viewer: CurrentUserPayload | undefined,
  ) {
    return this.activity.activitySummary(id, viewer?.id);
  }

  @Get(':id/recent-replies')
  @OptionalAuth()
  @ApiOperation({ summary: '查看用户最近 10 条回复（受 showRecentReplies 隐私开关控制）' })
  @ApiOkResponse({ type: RecentReplyResponseDto, isArray: true, description: '用户最近 10 条回复（含预览截断、所属帖子/子贴信息）' })
  @ApiNotFoundResponse({ description: '用户不存在或未公开最近动态' })
  async getUserRecentReplies(
    @Param('id') id: string,
    @CurrentUser() viewer: CurrentUserPayload | undefined,
  ) {
    return this.activity.recentReplies(id, viewer?.id);
  }

  @Get(':id')
  @OptionalAuth()
  @ApiOperation({ summary: '获取指定用户的公开资料。登录后额外返回关注/拉黑关系' })
  @ApiOkResponse({
    type: PublicUserResponseDto,
    description: '公开资料。登录后附加 isFollowing/isFollowedBy/isBlocked/isBlockedBy',
  })
  @ApiNotFoundResponse({ description: '用户不存在' })
  async getUser(@Param('id') id: string, @CurrentUser() viewer: CurrentUserPayload | undefined) {
    return this.usersService.findById(id, viewer?.id);
  }
}
