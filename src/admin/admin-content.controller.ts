import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AdminAuth } from './admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { AdminContentQueryService } from '../moderation/admin-content-query.service';
import { AdminContentTaxonomyService } from '../moderation/admin-content-taxonomy.service';
import { AdminContentQueryDto, UpdateContentTaxonomyDto } from './dto/admin-content.dto';
import {
  AdminContentDetailResponseDto,
  AdminContentResponseDto,
} from './dto/admin-content-response.dto';
import { AdminContentParamsDto } from '../moderation/dto/moderation.dto';

@ApiTags('Admin Content')
@Controller('admin/content')
@AdminAuth()
export class AdminContentController {
  constructor(
    private readonly queries: AdminContentQueryService,
    private readonly taxonomy: AdminContentTaxonomyService,
  ) {}

  @Get()
  @ApiOperation({ summary: '管理员内容列表' })
  @ApiCursorPaginatedResponse(AdminContentResponseDto, '公开内容和管理员隐藏项')
  list(@Query() query: AdminContentQueryDto) {
    return this.queries.list(query);
  }

  @Get(':type/:id')
  @ApiOperation({ summary: '管理员内容详情' })
  @ApiOkResponse({ type: AdminContentDetailResponseDto })
  detail(@Param() params: AdminContentParamsDto) {
    return this.queries.detail(params.type, params.id);
  }

  @Patch('thread/:id/taxonomy')
  @ApiOperation({ summary: '整理主题帖分类和标签' })
  @ApiOkResponse({ type: AdminContentDetailResponseDto })
  async updateTaxonomy(
    @Param('id') id: string,
    @Body() dto: UpdateContentTaxonomyDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    await this.taxonomy.update(id, dto, user.id, { ip: request.ip, requestId: request.id });
    return this.queries.detail('thread', id);
  }
}
