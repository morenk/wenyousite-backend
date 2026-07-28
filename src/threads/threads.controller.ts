import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ThreadsService } from './threads.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

/** 主题帖控制器：列表、创建、详情、修改、删除 */
@ApiTags('Threads')
@Controller('threads')
export class ThreadsController {
  constructor(private threadsService: ThreadsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '主题帖列表，支持分区筛选、排序、标签筛选、Cursor 分页' })
  async findAll(@Query() query: ThreadQueryDto) {
    return this.threadsService.findAll(query);
  }

  @Post()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建主题帖（自动生成第一个子贴和第一楼）' })
  async create(@Body() dto: CreateThreadDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.create(dto, user.id);
  }

  @Get(':id')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '主题帖详情，包含子贴列表和标签' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string } | undefined;
    return this.threadsService.findById(id, user?.id);
  }

  @Patch(':id')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改主题帖（仅 OWNER/COLLABORATOR）' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateThreadDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.threadsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '软删除主题帖（仅 OWNER）' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.threadsService.remove(id, user.id);
    return { message: '主题帖已删除' };
  }

  @Post(':id/invite-link')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '生成或刷新私密帖邀请链接（仅 OWNER）' })
  async createInviteLink(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.createInviteLink(id, user.id);
  }

  @Post('join-by-link/:token')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '通过邀请链接加入私密帖' })
  async joinByInviteLink(@Param('token') token: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.joinByInviteLink(token, user.id);
  }
}
