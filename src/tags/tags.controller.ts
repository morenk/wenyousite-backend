import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth, ApiOkResponse, ApiConflictResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';
import { TagResponseDto } from './dto/tag-response.dto';

/** 主题帖标签控制器：搜索与创建全局标签 */
@ApiTags('Tags')
@Controller('tags')
export class TagsController {
  constructor(private tagsService: TagsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '搜索主题帖标签（不传 q 返回全部）' })
  @ApiQuery({ name: 'q', required: false, description: '标签名称模糊搜索关键词' })
  @ApiOkResponse({ type: TagResponseDto, isArray: true, description: '标签列表（按名称排序），数量少时不缓存直接查库' })
  async search(@Query('q') q?: string) {
    return this.tagsService.search(q);
  }

  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建主题帖标签' })
  @ApiOkResponse({ type: TagResponseDto, description: '创建成功返回标签对象（含 id / name / color / createdAt）' })
  @ApiConflictResponse({ description: '标签名已存在' })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  async create(@Body() dto: CreateTagDto) {
    return this.tagsService.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '获取标签详情' })
  @ApiOkResponse({ type: TagResponseDto, description: '标签详情对象（id / name / color / createdAt）' })
  async getById(@Param('id') id: string) {
    return this.tagsService.findById(id);
  }
}
