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

/** 主题帖控制器：草稿箱、列表、详情、修改、发布、删除 */
@ApiTags('Threads')
@Controller('threads')
export class ThreadsController {
  constructor(private threadsService: ThreadsService) {}

  @Get('draft')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的草稿箱列表（未发布帖）' })
  async findDrafts(@Req() req: FastifyRequest) {
    const user = (req as any).user as { id: string };
    return this.threadsService.findDrafts(user.id);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: '主题帖列表（仅已发布帖）。filter=all(默认)=全部分开帖, filter=playing=我参与的帖（需登录）' })
  async findAll(@Query() query: ThreadQueryDto, @Req() req: FastifyRequest) {
    const user = (req as any).user as { id: string } | undefined;
    return this.threadsService.findAll(query, user?.id);
  }

  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建主题帖草稿。在沙盒内逐步完善后通过 PATCH 发布' })
  async create(@Body() dto: CreateThreadDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.create(dto, user.id);
  }

  @Get(':id')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '主题帖详情（含子贴列表）。未发布帖仅楼主可查看' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string } | undefined;
    return this.threadsService.findById(id, user?.id);
  }

  @Patch(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改主题帖（仅 OWNER/COLLABORATOR）。设置 published=true 即发布草稿' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateThreadDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.threadsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除主题帖。未发布帖硬删除，已发布帖软删除（仅 OWNER）' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.threadsService.remove(id, user.id);
    return { message: '主题帖已删除' };
  }

  @Post(':id/invite-link')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '生成或刷新私密帖邀请链接（仅 OWNER，需已发布）' })
  async createInviteLink(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.createInviteLink(id, user.id);
  }

  @Post('join-by-link/:token')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '通过邀请链接加入私密帖（需已发布）' })
  async joinByInviteLink(@Param('token') token: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.joinByInviteLink(token, user.id);
  }
}
