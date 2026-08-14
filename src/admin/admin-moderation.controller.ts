import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuth, SuperAdminStepUpAuth } from '../auth/decorators/admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { AdminActor, AdminRole } from './admin-policy.service';
import {
  AdminContentParamsDto,
  AdminHiddenContentQueryDto,
  AdminUserQueryDto,
  AuditLogQueryDto,
  ModerateContentDto,
  RevokeSanctionDto,
  SanctionUserDto,
  UpdateAdminRoleDto,
} from './dto/moderation.dto';
import {
  AdminAuditLogResponseDto,
  AdminContentModerationResponseDto,
  AdminHiddenContentResponseDto,
  AdminUserModerationResponseDto,
  AdminUserSanctionResponseDto,
} from './dto/moderation-response.dto';
import { ModerationService } from './moderation.service';
import { AdminModerationQueryService } from './admin-moderation-query.service';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return {
    id: user.id,
    username: user.username,
    role: user.role as AdminRole,
  };
}

function requestContext(request: FastifyRequest) {
  return { ip: request.ip, requestId: request.id };
}

@ApiTags('Admin Moderation')
@Controller('admin')
@AdminAuth()
export class AdminModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly queries: AdminModerationQueryService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: '管理员用户列表' })
  @ApiCursorPaginatedResponse(AdminUserModerationResponseDto, '管理员用户列表')
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.queries.listUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: '管理员用户详情' })
  @ApiOkResponse({ type: AdminUserModerationResponseDto })
  getUser(@Param('id') id: string) {
    return this.queries.getUser(id);
  }

  @Post('users/:id/sanctions')
  @ApiOperation({ summary: '暂停或永久封禁用户' })
  @ApiCreatedResponse({ type: AdminUserSanctionResponseDto })
  sanctionUser(
    @Param('id') id: string,
    @Body() dto: SanctionUserDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.moderation.sanctionUser(actorFrom(user), id, dto, requestContext(request));
  }

  @Post('users/:id/sanctions/current/revoke')
  @ApiOperation({ summary: '解除用户当前处罚' })
  @ApiOkResponse({ type: AdminUserSanctionResponseDto })
  revokeSanction(
    @Param('id') id: string,
    @Body() dto: RevokeSanctionDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.moderation.revokeSanction(actorFrom(user), id, dto.reason, requestContext(request));
  }

  @Patch('users/:id/role')
  @SuperAdminStepUpAuth()
  @ApiOperation({ summary: '撤销管理员角色；授予请使用邀请流程（超级管理员）' })
  @ApiOkResponse({ type: AdminUserModerationResponseDto })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.moderation.updateRole(
      actorFrom(user),
      id,
      dto.role,
      dto.reason,
      requestContext(request),
    );
  }

  @Post('content/:type/:id/hide')
  @ApiOperation({ summary: '隐藏主题帖、帖子、动态或动态评论' })
  @ApiOkResponse({ type: AdminContentModerationResponseDto })
  hideContent(
    @Param() params: AdminContentParamsDto,
    @Body() dto: ModerateContentDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.moderation.hideContent(
      actorFrom(user),
      params.type.toUpperCase() as 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
      params.id,
      dto.reason,
      requestContext(request),
    );
  }

  @Get('content/hidden')
  @ApiOperation({ summary: '当前仍由管理员隐藏的内容列表' })
  @ApiCursorPaginatedResponse(AdminHiddenContentResponseDto, '当前隐藏内容列表')
  listHiddenContent(@Query() query: AdminHiddenContentQueryDto) {
    return this.queries.listHiddenContent(query);
  }

  @Post('content/:type/:id/restore')
  @ApiOperation({ summary: '恢复由管理员隐藏的主题帖、帖子、动态或动态评论' })
  @ApiOkResponse({ type: AdminContentModerationResponseDto })
  restoreContent(
    @Param() params: AdminContentParamsDto,
    @Body() dto: ModerateContentDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.moderation.restoreContent(
      actorFrom(user),
      params.type.toUpperCase() as 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
      params.id,
      dto.reason,
      requestContext(request),
    );
  }

  @Get('audit-logs')
  @ApiOperation({ summary: '管理员审计日志' })
  @ApiCursorPaginatedResponse(AdminAuditLogResponseDto, '不可变管理员审计日志')
  listAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.queries.listAuditLogs(query);
  }

  @Get('audit-logs/export')
  @ApiOperation({ summary: '按当前筛选导出管理员审计日志 CSV（最多 10000 条）' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'UTF-8 CSV，包含 BOM 并防止表格公式注入',
    schema: { type: 'string', format: 'binary' },
  })
  async exportAuditLogs(@Query() query: AuditLogQueryDto, @Res() reply: FastifyReply) {
    const csv = await this.queries.exportAuditLogs(query);
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="wenyou-audit-${date}.csv"`)
      .send(csv);
  }
}
