import {
  Controller, Get, Post, Delete,
  Body, Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ThreadsService } from './threads.service';
import { AddThreadTagDto } from './dto/add-thread-tag.dto';

/** 主题帖标签关联控制器 */
@ApiTags('Threads')
@Controller('threads/:threadId/tags')
export class ThreadTagsController {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private threadsService: ThreadsService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '获取主题帖关联的标签列表' })
  async findAll(@Param('threadId') threadId: string) {
    return this.prisma.threadTopicTag.findMany({
      where: { threadId },
      include: { tag: true },
    });
  }

  @Post()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '为主题帖添加标签（仅 OWNER/COLLABORATOR）' })
  async add(@Param('threadId') threadId: string, @Body() dto: AddThreadTagDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.threadsService.assertCanManage(threadId, user.id);

    const tags = await this.tagsService.findOrCreate([dto.name]);
    const tag = tags[0];
    await this.prisma.threadTopicTag.upsert({
      where: { threadId_tagId: { threadId, tagId: tag.id } },
      create: { threadId, tagId: tag.id },
      update: {},
    });
    return tag;
  }

  @Delete(':tagId')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移除主题帖的标签（仅 OWNER/COLLABORATOR）' })
  async remove(@Param('threadId') threadId: string, @Param('tagId') tagId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.threadsService.assertCanManage(threadId, user.id);

    await this.prisma.threadTopicTag.deleteMany({
      where: { threadId, tagId },
    });
    return { message: '标签已移除' };
  }
}
