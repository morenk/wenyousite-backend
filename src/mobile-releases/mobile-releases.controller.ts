import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { AdminAuth, SuperAdminAuth } from '../admin/admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminActor } from '../moderation/admin-policy.service';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import {
  AdminMobileReleaseDto,
  CreateMobileReleaseDto,
  MobileReleaseBuildDto,
  MobileReleaseQueryDto,
  MobileReleaseRevisionDto,
  PublicMobileReleaseDto,
  UpdateMobileReleaseDto,
} from './mobile-release.dto';
import { MobileReleasesService } from './mobile-releases.service';

@ApiTags('Mobile Releases')
@Controller('mobile-releases')
export class MobileReleasesController {
  constructor(private readonly releases: MobileReleasesService) {}
  @Get()
  @Public()
  @ApiOperation({ summary: '已发布版本历史，按构建号倒序；仅返回公开快照' })
  @ApiCursorPaginatedResponse(PublicMobileReleaseDto, '已发布版本说明')
  list(@Query() query: MobileReleaseQueryDto) {
    return this.releases.list(query);
  }

  @Get(':platform/:buildNumber')
  @Public()
  @ApiOperation({ summary: '读取已发布版本说明；不存在或未发布均为 404' })
  @ApiOkResponse({ type: PublicMobileReleaseDto })
  @ApiNotFoundResponse({ description: '无已发布说明' })
  detail(@Param() params: MobileReleaseBuildDto) {
    return this.releases.published(params.platform, params.buildNumber);
  }
}
function actor(user: CurrentUserPayload): AdminActor {
  return { id: user.id, username: user.username, role: user.role as AdminActor['role'] };
}
function context(request: FastifyRequest) {
  return { ip: request.ip, requestId: request.id };
}

@ApiTags('Admin Mobile Releases')
@Controller('admin/mobile-releases')
export class AdminMobileReleasesController {
  constructor(private readonly releases: MobileReleasesService) {}
  @Get()
  @AdminAuth()
  @ApiCursorPaginatedResponse(AdminMobileReleaseDto, '版本说明编辑稿及快照，按构建号倒序')
  list(@Query() query: MobileReleaseQueryDto) {
    return this.releases.list(query, true);
  }

  @Get(':id')
  @AdminAuth()
  @ApiOkResponse({ type: AdminMobileReleaseDto })
  detail(@Param('id') id: string) {
    return this.releases.get(id);
  }

  @Post()
  @AdminAuth()
  @ApiCreatedResponse({ type: AdminMobileReleaseDto })
  @ApiConflictResponse({ description: '平台与构建号已存在，禁止重新绑定版本名' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateMobileReleaseDto,
    @Req() request: FastifyRequest,
  ) {
    return this.releases.create(actor(user), dto, context(request));
  }
  @Patch(':id')
  @AdminAuth()
  @ApiOkResponse({ type: AdminMobileReleaseDto })
  @ApiOperation({ summary: '更新编辑稿；已发布版本仅 SUPER_ADMIN 可修正，旧公开快照保留' })
  @ApiConflictResponse({ description: 'revision 已变化或发布锁定' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMobileReleaseDto,
    @Req() request: FastifyRequest,
  ) {
    return this.releases.update(actor(user), id, dto, context(request));
  }
  @Post(':id/confirm')
  @SuperAdminAuth()
  @ApiCreatedResponse({ type: AdminMobileReleaseDto })
  @ApiOperation({
    summary: '超级管理员确认当前 revision；已发布文案原子换为确认快照，不触发安装包发布',
  })
  @ApiConflictResponse({ description: 'revision 已变化或发布锁定' })
  confirm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: MobileReleaseRevisionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.releases.confirm(actor(user), id, dto.revision, context(request));
  }
}
