import {
  Controller, Get, Post, Body, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ReadingProgressService } from './reading-progress.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Reading Progress')
@Controller('reading-progress')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReadingProgressController {
  constructor(private readingProgressService: ReadingProgressService) {}

  @Get()
  @ApiOperation({ summary: '查询阅读进度（按子贴）' })
  async get(@Req() req: FastifyRequest, @Query('subthreadId') subthreadId: string) {
    const user = req['user'] as { id: string };
    if (!subthreadId) return this.readingProgressService.findAll(user.id);
    return this.readingProgressService.findBySubthread(user.id, subthreadId);
  }

  @Post()
  @ApiOperation({ summary: '记录阅读进度（精确到楼层/楼中楼）' })
  async update(
    @Req() req: FastifyRequest,
    @Body() dto: { subthreadId: string; postId?: string },
  ) {
    const user = req['user'] as { id: string };
    return this.readingProgressService.update(user.id, dto.subthreadId, dto.postId);
  }
}
