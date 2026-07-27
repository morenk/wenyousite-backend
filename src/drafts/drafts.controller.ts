import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { DraftsService } from './drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/** 草稿控制器：5 槽位自动/手动保存 */
@ApiTags('Drafts')
@Controller('drafts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DraftsController {
  constructor(private draftsService: DraftsService) {}

  @Get()
  @ApiOperation({ summary: '草稿列表（可选按子贴筛选）' })
  @ApiQuery({ name: 'subthreadId', required: false })
  async findAll(@Req() req: FastifyRequest, @Query('subthreadId') subthreadId?: string) {
    const user = req['user'] as { id: string };
    return this.draftsService.findAll(user.id, subthreadId);
  }

  @Get('slots')
  @ApiOperation({ summary: '草稿位使用情况（每子贴已用槽位数）' })
  async slotUsage(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.slotUsage(user.id);
  }

  @Post()
  @ApiOperation({ summary: '保存草稿（不传 slot 则自动选空闲位）' })
  async create(@Body() dto: CreateDraftDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.create(dto, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单条草稿' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.findById(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新草稿内容' })
  async update(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.draftsService.update(id, content, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除草稿' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.draftsService.remove(id, user.id);
    return { message: '草稿已删除' };
  }
}
