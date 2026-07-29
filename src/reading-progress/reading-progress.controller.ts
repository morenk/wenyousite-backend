import { Controller, Get, Post, Body, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ReadingProgressService } from './reading-progress.service';
import { UpdateReadingProgressDto } from './dto/update-reading-progress.dto';
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
  async get(@Req() req: FastifyRequest, @Query('subthreadId') subthreadId: string) {
    const user = req['user'] as { id: string };
    if (!subthreadId) return this.readingProgressService.findAll(user.id);
    return this.readingProgressService.findBySubthread(user.id, subthreadId);
  }

  /** 帖级聚合：一次性返回主题帖下所有子贴的阅读摘要 */
  @Get('thread')
  @ApiOperation({ summary: '帖级聚合：一次返回整帖所有子贴的阅读摘要' })
  async threadAggregation(@Req() req: FastifyRequest, @Query('threadId') threadId: string) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.threadAggregation(user.id, threadId);
  }

  /** 自上次阅读后新增回复数（按子贴） */
  @Get('new-replies')
  @ApiOperation({ summary: '自上次阅读后子贴新增回复数' })
  async newReplies(@Req() req: FastifyRequest, @Query('subthreadId') subthreadId: string) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.newRepliesSince(user.id, subthreadId);
  }

  /** 记录阅读进度（精确到楼层/楼中楼） */
  @Post()
  @ApiOperation({ summary: '记录阅读进度（精确到楼层/楼中楼）' })
  async update(@Req() req: FastifyRequest, @Body() dto: UpdateReadingProgressDto) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.update(user.id, dto.subthreadId, dto.postId);
  }
}
