import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { UserRelationsService } from './user-relations.service';
import { MessageResponseDto } from '../common/dto/message-response.dto';

/** 关注与拉黑 HTTP 适配器；业务规则由 UserRelationsService 负责。 */
@ApiTags('Users')
@Controller('users')
export class UsersFollowController {
  constructor(private readonly relations: UserRelationsService) {}

  @Post('follow/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '关注用户' })
  @ApiOkResponse({ type: MessageResponseDto, description: '关注结果（成功 / 已关注 / 不能关注自己）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '目标用户不存在' })
  follow(@Param('id') targetId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.relations.follow(user, targetId);
  }

  @Delete('follow/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消关注' })
  @ApiOkResponse({ type: MessageResponseDto, description: '已取消关注' })
  unfollow(@Param('id') targetId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.relations.unfollow(user.id, targetId);
  }

  @Get('following')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的关注列表' })
  @ApiOkResponse({ description: '我的关注用户列表' })
  following(@CurrentUser() user: CurrentUserPayload) {
    return this.relations.following(user.id);
  }

  @Get('followers')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的粉丝列表' })
  @ApiOkResponse({ description: '我的粉丝列表' })
  followers(@CurrentUser() user: CurrentUserPayload) {
    return this.relations.followers(user.id);
  }

  @Get(':id/following')
  @OptionalAuth()
  @ApiOperation({ summary: '指定用户的关注列表' })
  @ApiOkResponse({ description: '指定用户的关注列表' })
  userFollowing(@Param('id') id: string) {
    return this.relations.userFollowing(id);
  }

  @Get(':id/followers')
  @OptionalAuth()
  @ApiOperation({ summary: '指定用户的粉丝列表' })
  @ApiOkResponse({ description: '指定用户的粉丝列表' })
  userFollowers(@Param('id') id: string) {
    return this.relations.userFollowers(id);
  }

  @Post('me/block/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '拉黑用户' })
  @ApiOkResponse({ type: MessageResponseDto, description: '拉黑结果' })
  block(@Param('id') targetId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.relations.block(user.id, targetId);
  }

  @Delete('me/block/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消拉黑' })
  @ApiOkResponse({ type: MessageResponseDto, description: '已取消拉黑' })
  unblock(@Param('id') targetId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.relations.unblock(user.id, targetId);
  }

  @Get('me/blocks')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的黑名单' })
  @ApiOkResponse({ description: '我的黑名单列表' })
  blocks(@CurrentUser() user: CurrentUserPayload) {
    return this.relations.blocks(user.id);
  }
}
