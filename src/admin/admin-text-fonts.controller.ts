import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuth, AdminStepUpAuth } from './admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { FontAdminService } from '../text-fonts/font-admin.service';
import { FontQueryService } from '../text-fonts/font-query.service';
import { fontAssetResponse } from '../text-fonts/font-http';
import { RouteConfig } from '@nestjs/platform-fastify';
import { FONT_SOURCE_ROUTE_CONFIG } from '../text-fonts/font-upload';
import {
  FontAdminFamilyDetailDto,
  FontAdminListQueryDto,
  FontAdminPageDto,
  FontConfigurationDto,
  FontEnabledDto,
  FontFamilyDto,
  FontJobDto,
  FontPublishDto,
  FontSourceQueryDto,
  FontWithdrawDto,
  UpdateFontConfigurationDto,
} from '../text-fonts/dto/font-admin.dto';
import { FontVersionDescriptorDto } from '../text-fonts/dto/font-public.dto';

const context = (user: CurrentUserPayload, request: FastifyRequest) => ({
  actorId: user.id,
  ip: request.ip,
  requestId: request.id,
});

@ApiTags('Admin Text Fonts')
@Controller('admin/text-fonts')
@AdminAuth()
export class AdminTextFontsController {
  constructor(
    private readonly fonts: FontAdminService,
    private readonly queries: FontQueryService,
  ) {}

  @Get()
  @ApiOkResponse({ type: FontAdminPageDto })
  async list(@Query() query: FontAdminListQueryDto): Promise<FontAdminPageDto> {
    return this.queries.list(query);
  }

  @Post()
  @ApiCreatedResponse({ type: FontFamilyDto })
  async create(
    @Body() dto: FontConfigurationDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontFamilyDto> {
    return this.fonts.create(dto, context(user, request));
  }

  @Get('jobs/:jobId')
  @ApiOkResponse({ type: FontJobDto })
  async getJob(@Param('jobId') jobId: string): Promise<FontJobDto> {
    return this.queries.job(jobId);
  }

  @Post('jobs/:jobId/process')
  @ApiCreatedResponse({
    type: FontJobDto,
    description:
      '确认三项权利与完整授权后排队；同一 job 重放幂等，失败 job 可重试，使用上传时配置快照。',
  })
  async process(
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontJobDto> {
    return this.fonts.process(jobId, context(user, request));
  }

  @Get('versions/:versionId/preview')
  @ApiOkResponse({ type: FontVersionDescriptorDto })
  async preview(@Param('versionId') versionId: string): Promise<FontVersionDescriptorDto> {
    return this.queries.version(versionId, true);
  }

  @Get('versions/:versionId/assets/:asset')
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description: '管理员预览输出；撤回版本也禁止下载，源文件保留在私有暂存。',
  })
  async asset(
    @Param('versionId') versionId: string,
    @Param('asset') asset: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    fontAssetResponse(await this.queries.asset(versionId, asset, true), reply, true);
  }

  @Post('versions/:versionId/withdraw')
  @AdminStepUpAuth()
  @ApiCreatedResponse({
    type: FontVersionDescriptorDto,
    description: '不可逆紧急撤回；新目录原子移除，后续下载拒绝，原正文与历史对象不删除。',
  })
  async withdraw(
    @Param('versionId') versionId: string,
    @Body() dto: FontWithdrawDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontVersionDescriptorDto> {
    return this.fonts.withdraw(versionId, dto, context(user, request));
  }

  @Get(':familyId')
  @ApiOkResponse({ type: FontAdminFamilyDetailDto })
  async detail(@Param('familyId') familyId: string): Promise<FontAdminFamilyDetailDto> {
    return this.queries.detail(familyId);
  }

  @Patch(':familyId')
  @ApiOkResponse({
    type: FontFamilyDto,
    description: '修改下一次上传的配置，不改历史版本元数据；当前目录排序需重新 publish。',
  })
  async update(
    @Param('familyId') familyId: string,
    @Body() dto: UpdateFontConfigurationDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontFamilyDto> {
    return this.fonts.update(familyId, dto, context(user, request));
  }

  @Post(':familyId/sources')
  @RouteConfig(FONT_SOURCE_ROUTE_CONFIG)
  @ApiConsumes('application/octet-stream')
  @ApiBody({
    schema: {
      type: 'string',
      format: 'binary',
      description: '单个原始 TTF/OTF，最大 67108864 字节；不是 base64、ZIP、TTC 或外链。',
    },
  })
  @ApiCreatedResponse({
    type: FontJobDto,
    description: '只暂存源，不解析。形成不可变配置快照的 draft job，需显式 process。',
  })
  async upload(
    @Param('familyId') familyId: string,
    @Query() query: FontSourceQueryDto,
    @Body() source: Buffer,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontJobDto> {
    return this.fonts.upload(familyId, query, source, context(user, request));
  }

  @Post(':familyId/publish')
  @ApiCreatedResponse({
    type: FontFamilyDto,
    description:
      '发布或回滚到已有成功版本；先核验资源可读，再原子切换未来选用与目录。旧帖版本不变。',
  })
  async publish(
    @Param('familyId') familyId: string,
    @Body() dto: FontPublishDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontFamilyDto> {
    return this.fonts.publish(familyId, dto, context(user, request));
  }

  @Patch(':familyId/enabled')
  @ApiOkResponse({
    type: FontFamilyDto,
    description: '停用禁止新选与粘贴，但仍可读取历史描述符/资产；重新启用不会恢复已撤回版本。',
  })
  async enabled(
    @Param('familyId') familyId: string,
    @Body() dto: FontEnabledDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ): Promise<FontFamilyDto> {
    return this.fonts.enabled(familyId, dto, context(user, request));
  }
}
