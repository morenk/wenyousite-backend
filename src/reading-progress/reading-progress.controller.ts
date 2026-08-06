import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ReadingProgressService } from './reading-progress.service';
import { UpdateReadingProgressDto } from './dto/update-reading-progress.dto';
import {
  NewRepliesResponseDto,
  ThreadNewRepliesResponseDto,
} from './dto/reading-progress-response.dto';
import { AuthRead } from '../auth/decorators/auth.decorator';

/** 阅读进度控制器：记录和查询用户的阅读位置 */
@ApiTags('Reading Progress')
@Controller('reading-progress')
@AuthRead()
@ApiBearerAuth()
export class ReadingProgressController {
  constructor(private readingProgressService: ReadingProgressService) {}

  /** 查询阅读进度（按子贴） */
  @Get()
  @ApiOperation({ summary: '查询阅读进度（按子贴）' })
  @ApiOkResponse({ description: '阅读进度记录（不传 subthreadId 返回全部子贴进度）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async get(@Req() req: FastifyRequest, @Query('subthreadId') subthreadId: string) {
    const user = req['user'] as { id: string };
    if (!subthreadId) return this.readingProgressService.findAll(user.id);
    return this.readingProgressService.findBySubthread(user.id, subthreadId);
  }

  /** 自上次阅读后新增回复数（按子贴） */
  @Get('new-replies')
  @ApiOperation({ summary: '自上次阅读后子贴新增回复数' })
  @ApiOkResponse({ type: NewRepliesResponseDto, description: '新增回复数' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async newReplies(@Req() req: FastifyRequest, @Query('subthreadId') subthreadId: string) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.newRepliesSince(user.id, subthreadId);
  }

  /** 一次查询主题帖下全部子贴的新增回复数 */
  @Get('threads/:threadId/new-replies')
  @ApiOperation({ summary: '查询主题帖全部子贴的新增回复数' })
  @ApiOkResponse({ type: ThreadNewRepliesResponseDto, description: '按子贴汇总的新增回复数' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async threadNewReplies(@Req() req: FastifyRequest, @Param('threadId') threadId: string) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.newRepliesForThread(user.id, threadId);
  }

  /** 记录阅读进度（精确到楼层/楼中楼） */
  @Post()
  @ApiOperation({ summary: '记录阅读进度（精确到楼层/楼中楼）' })
  @ApiOkResponse({ description: '已记录阅读进度' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async update(@Req() req: FastifyRequest, @Body() dto: UpdateReadingProgressDto) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.update(user.id, dto.subthreadId, dto.postId);
  }
}
