import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';

/** 主题帖标签控制器：搜索与创建全局标签 */
@ApiTags('Tags')
@Controller('tags')
export class TagsController {
  constructor(private tagsService: TagsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '搜索主题帖标签' })
  @ApiQuery({ name: 'q', required: false, description: '标签名称模糊搜索' })
  async search(@Query('q') q?: string) {
    return this.tagsService.search(q);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '创建主题帖标签' })
  async create(@Body() dto: CreateTagDto) {
    return this.tagsService.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '获取标签详情' })
  async getById(@Param('id') id: string) {
    return this.tagsService.findById(id);
  }
}
