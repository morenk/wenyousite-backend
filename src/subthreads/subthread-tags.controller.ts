import {
  Controller, Get, Post, Delete,
  Body, Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { SubthreadsService } from './subthreads.service';
import { AddSubthreadTagDto } from './dto/add-subthread-tag.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

/** 子贴标签关联控制器 */
@ApiTags('Subthreads')
@Controller('subthreads/:subthreadId/tags')
export class SubthreadTagsController {
  constructor(
    private prisma: PrismaService,
    private subthreadsService: SubthreadsService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '获取子贴的标签列表' })
  async findAll(@Param('subthreadId') subthreadId: string) {
    return this.prisma.subthreadTag.findMany({
      where: { subthreadId },
      include: { tag: true },
    });
  }

  @Post()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '为子贴添加标签（仅 OWNER/COLLABORATOR）' })
  async add(
    @Param('subthreadId') subthreadId: string,
    @Body() dto: AddSubthreadTagDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    const subthread = await this.subthreadsService.findById(subthreadId);
    await this.subthreadsService.assertCanManage(subthread.threadId, user.id);

    // 查找或创建子贴标签定义
    let tagDef = await this.prisma.subthreadTagDef.findFirst({
      where: { threadId: subthread.threadId, name: dto.name },
    });
    if (!tagDef) {
      tagDef = await this.prisma.subthreadTagDef.create({
        data: { threadId: subthread.threadId, name: dto.name, color: dto.color },
      });
    }

    // 关联子贴与标签
    await this.prisma.subthreadTag.upsert({
      where: { subthreadId_tagId: { subthreadId, tagId: tagDef.id } },
      create: { subthreadId, tagId: tagDef.id },
      update: {},
    });

    return tagDef;
  }

  @Delete(':tagId')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移除子贴的标签（仅 OWNER/COLLABORATOR）' })
  async remove(
    @Param('subthreadId') subthreadId: string,
    @Param('tagId') tagId: string,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    const subthread = await this.subthreadsService.findById(subthreadId);
    await this.subthreadsService.assertCanManage(subthread.threadId, user.id);

    await this.prisma.subthreadTag.deleteMany({
      where: { subthreadId, tagId },
    });
    return { message: '标签已移除' };
  }
}
