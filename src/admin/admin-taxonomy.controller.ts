import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AdminAuth } from './admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { TagResponseDto } from '../tags/dto/tag-response.dto';
import {
  CreateThreadCategoryDto,
  UpdateThreadCategoryDto,
} from '../taxonomy/dto/thread-category.dto';
import { ThreadCategoryResponseDto } from '../taxonomy/dto/thread-category-response.dto';
import { AdminTaxonomyService } from './admin-taxonomy.service';
import { CreateManagedTagDto, UpdateManagedTagDto } from './dto/taxonomy.dto';

function requestContext(request: FastifyRequest) {
  return { ip: request.ip, requestId: request.id };
}

@ApiTags('Admin Taxonomy')
@Controller('admin')
@AdminAuth()
export class AdminTaxonomyController {
  constructor(private readonly taxonomy: AdminTaxonomyService) {}

  @Get('thread-categories')
  @ApiOperation({ summary: '管理员主题帖分类列表（含停用项）' })
  @ApiOkResponse({ type: ThreadCategoryResponseDto, isArray: true })
  listCategories() {
    return this.taxonomy.listCategories();
  }

  @Post('thread-categories')
  @ApiOperation({ summary: '新增主题帖分类' })
  @ApiCreatedResponse({ type: ThreadCategoryResponseDto })
  createCategory(
    @Body() dto: CreateThreadCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.taxonomy.createCategory({ id: user.id }, dto, requestContext(request));
  }

  @Patch('thread-categories/:id')
  @ApiOperation({ summary: '编辑、排序或停用主题帖分类' })
  @ApiOkResponse({ type: ThreadCategoryResponseDto })
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateThreadCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.taxonomy.updateCategory({ id: user.id }, id, dto, requestContext(request));
  }

  @Get('tags')
  @ApiOperation({ summary: '管理员标签列表（含停用项）' })
  @ApiOkResponse({ type: TagResponseDto, isArray: true })
  listTags() {
    return this.taxonomy.listTags();
  }

  @Post('tags')
  @ApiOperation({ summary: '新增平台标签' })
  @ApiCreatedResponse({ type: TagResponseDto })
  createTag(
    @Body() dto: CreateManagedTagDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.taxonomy.createTag({ id: user.id }, dto, requestContext(request));
  }

  @Patch('tags/:id')
  @ApiOperation({ summary: '编辑、排序或停用平台标签' })
  @ApiOkResponse({ type: TagResponseDto })
  updateTag(
    @Param('id') id: string,
    @Body() dto: UpdateManagedTagDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.taxonomy.updateTag({ id: user.id }, id, dto, requestContext(request));
  }
}
