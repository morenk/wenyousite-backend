import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { ThreadIdentitiesService } from './thread-identities.service';
import {
  CreateRpIdentityDto,
  DeleteRpIdentityDto,
  RpIdentityCollectionDto,
  RpIdentityStateDto,
  UpdateRpIdentityDto,
} from './thread-identity.dto';

@ApiTags('Threads')
@Controller('threads/:threadId/rp-identities')
export class RpIdentitiesController {
  constructor(private readonly identities: ThreadIdentitiesService) {}
  @Get()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '列出自己的帖内角色及各角色发表确认 token（最多十个）' })
  @ApiOkResponse({ type: RpIdentityCollectionDto })
  list(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    return this.identities.list(threadId, req.user!.id);
  }
  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '新增一个帖内角色；首次建立兼容锚点，归档后不自动替换' })
  @ApiCreatedResponse({ type: RpIdentityStateDto })
  create(
    @Param('threadId') threadId: string,
    @Req() req: FastifyRequest,
    @Body() dto: CreateRpIdentityDto,
  ) {
    return this.identities.update(threadId, req.user!.id, dto, undefined, true);
  }
  @Get(':identityId')
  @OptionalAuth()
  @ApiOperation({ summary: '按稳定角色 ID 读取身份卡；删除后只返回账号及删除状态' })
  @ApiOkResponse({ type: RpIdentityStateDto })
  find(
    @Param('threadId') threadId: string,
    @Param('identityId') identityId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.identities.role(threadId, identityId, req.user?.id);
  }
  @Put(':identityId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改自己的指定角色；只影响此角色之后的新发言' })
  @ApiOkResponse({ type: RpIdentityStateDto })
  update(
    @Param('threadId') threadId: string,
    @Param('identityId') identityId: string,
    @Req() req: FastifyRequest,
    @Body() dto: UpdateRpIdentityDto,
  ) {
    return this.identities.update(threadId, req.user!.id, dto, identityId);
  }
  @Delete(':identityId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除自己的指定角色并释放名额；历史身份和媒体保留' })
  @ApiOkResponse({ type: RpIdentityStateDto })
  remove(
    @Param('threadId') threadId: string,
    @Param('identityId') identityId: string,
    @Req() req: FastifyRequest,
    @Body() dto: DeleteRpIdentityDto,
  ) {
    return this.identities.remove(threadId, req.user!.id, identityId, dto.version);
  }
}
