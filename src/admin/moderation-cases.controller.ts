import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminAuth, AdminStepUpAuth } from '../auth/decorators/admin-auth.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminActor, AdminRole } from './admin-policy.service';
import {
  CreateModerationAppealDto,
  ModerationAppealQueryDto,
  ModerationCaseQueryDto,
  ResolveModerationAppealDto,
  ResolveModerationCaseDto,
} from './dto/moderation-case.dto';
import { ModerationCasesService } from './moderation-cases.service';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { ModerationAppealResponseDto, ModerationCaseResponseDto, ModerationDecisionPublicResponseDto } from './dto/admin-station-response.dto';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return { id: user.id, username: user.username, role: user.role as AdminRole };
}

function context(request: FastifyRequest) {
  return { ip: request.ip, requestId: request.id };
}

@ApiTags('Admin Cases')
@Controller('admin/cases')
@AdminAuth()
export class ModerationCasesController {
  constructor(private readonly cases: ModerationCasesService) {}

  @Get()
  @ApiOperation({ summary: '按同一目标聚合后的治理案件队列' })
  @ApiCursorPaginatedResponse(ModerationCaseResponseDto, '治理案件队列')
  list(@Query() query: ModerationCaseQueryDto) {
    return this.cases.listCases(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '案件证据、举报人、决定和申诉轨迹' })
  @ApiOkResponse({ type: ModerationCaseResponseDto })
  get(@Param('id') id: string) {
    return this.cases.getCase(id);
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: '以公开说明和规则分类原子结案' })
  @ApiCreatedResponse({ type: ModerationCaseResponseDto })
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ResolveModerationCaseDto,
    @Req() request: FastifyRequest,
  ) {
    return this.cases.resolveCase(id, actorFrom(user), dto, context(request));
  }
}

@ApiTags('Admin Appeals')
@Controller('admin/appeals')
@AdminAuth()
export class AdminModerationAppealsController {
  constructor(private readonly cases: ModerationCasesService) {}

  @Get()
  @ApiOperation({ summary: '申诉处理队列' })
  @ApiCursorPaginatedResponse(ModerationAppealResponseDto, '申诉处理队列')
  list(@Query() query: ModerationAppealQueryDto) {
    return this.cases.listAppeals(query);
  }

  @Post(':id/resolve')
  @AdminStepUpAuth()
  @ApiOperation({ summary: '维持或推翻治理决定；推翻会恢复内容或解除处罚' })
  @ApiCreatedResponse({ type: ModerationAppealResponseDto })
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ResolveModerationAppealDto,
    @Req() request: FastifyRequest,
  ) {
    return this.cases.resolveAppeal(id, actorFrom(user), dto, context(request));
  }
}

@ApiTags('Moderation Appeals')
@Controller('moderation')
export class UserModerationAppealsController {
  constructor(private readonly cases: ModerationCasesService) {}

  @Get('decisions/mine')
  @Auth()
  @ApiOperation({ summary: '当前用户近 30 天可申诉的治理决定（Web/移动端兼容）' })
  @ApiOkResponse({ type: ModerationDecisionPublicResponseDto, isArray: true })
  mine(@CurrentUser() user: CurrentUserPayload) {
    return this.cases.listMyDecisions(user.id);
  }

  @Post('appeals')
  @Auth()
  @ApiOperation({ summary: '对自己的治理决定提交一次申诉（Web/移动端兼容）' })
  @ApiCreatedResponse({ type: ModerationAppealResponseDto })
  appeal(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateModerationAppealDto) {
    return this.cases.createAppeal(user.id, dto.decisionId, dto.statement);
  }
}
