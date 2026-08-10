import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AdminAccountReasonDto,
  CreateAdminInviteDto,
  TransferSuperAdminDto,
} from './dto/admin-accounts.dto';
import {
  SuperAdminAuth,
  SuperAdminStepUpAuth,
} from '../auth/decorators/admin-auth.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminActor, AdminRole } from './admin-policy.service';
import { AdminAccountsResponseDto, AdminInviteCreatedResponseDto } from './dto/admin-station-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return { id: user.id, username: user.username, role: user.role as AdminRole };
}

function context(request: FastifyRequest) {
  return { ip: request.ip, requestId: request.id };
}

@ApiTags('Admin Accounts')
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @SuperAdminAuth()
  @ApiOperation({ summary: '管理员账号、会话和待处理邀请' })
  @ApiOkResponse({ type: AdminAccountsResponseDto })
  list() {
    return this.accounts.list();
  }

  @Post('invites')
  @SuperAdminStepUpAuth()
  @ApiOperation({ summary: '邀请现有温油账号成为管理员' })
  @ApiCreatedResponse({ type: AdminInviteCreatedResponseDto })
  invite(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateAdminInviteDto,
    @Req() request: FastifyRequest,
  ) {
    return this.accounts.invite(actorFrom(user), dto.userId, context(request));
  }

  @Delete('invites/:id')
  @SuperAdminStepUpAuth()
  @ApiOperation({ summary: '取消待处理管理员邀请' })
  @ApiOkResponse({ type: MessageResponseDto })
  cancel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AdminAccountReasonDto,
    @Req() request: FastifyRequest,
  ) {
    return this.accounts.cancel(actorFrom(user), id, dto.reason, context(request));
  }

  @Delete(':id')
  @SuperAdminStepUpAuth()
  @ApiOperation({ summary: '撤销普通管理员身份并注销其会话' })
  @ApiOkResponse({ type: MessageResponseDto })
  revoke(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AdminAccountReasonDto,
    @Req() request: FastifyRequest,
  ) {
    return this.accounts.revoke(actorFrom(user), id, dto.reason, context(request));
  }

  @Post('transfer-super-admin')
  @SuperAdminStepUpAuth()
  @ApiOperation({ summary: '把唯一超级管理员身份移交给另一名管理员' })
  @ApiCreatedResponse({ type: MessageResponseDto })
  transfer(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: TransferSuperAdminDto,
    @Req() request: FastifyRequest,
  ) {
    return this.accounts.transferSuperAdmin(actorFrom(user), dto.userId, dto.reason, context(request));
  }
}

@ApiTags('Admin Accounts')
@Controller('admin-invitations')
export class AdminInviteAcceptanceController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Post(':token/accept')
  @Auth()
  @ApiOperation({ summary: '当前温油账号接受管理员邀请（Web）' })
  @ApiCreatedResponse({ type: MessageResponseDto })
  accept(@CurrentUser() user: CurrentUserPayload, @Param('token') token: string) {
    return this.accounts.accept(token, user.id);
  }
}
