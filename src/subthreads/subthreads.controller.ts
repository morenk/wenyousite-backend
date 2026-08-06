import {
  Controller, Get, Post, Patch, Delete, Put,
  Body, Param, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { SubthreadsService } from './subthreads.service';
import { CreateSubthreadDto } from './dto/create-subthread.dto';
import { UpdateSubthreadDto } from './dto/update-subthread.dto';
import { ReorderSubthreadsDto } from './dto/reorder-subthreads.dto';
import { Auth, OptionalAuth } from '../auth/decorators/auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';

/** 子贴控制器：列表、创建、详情、修改、删除、重排 */
@ApiTags('Subthreads')
@Controller()
export class SubthreadsController {
  constructor(private subthreadsService: SubthreadsService) {}

  @Get('threads/:threadId/subthreads')
  @OptionalAuth()
  @ApiOperation({ summary: '获取主题帖下的子贴列表' })
  async findAll(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    const user = req.user as { id: string } | undefined;
    return this.subthreadsService.findAll(threadId, user?.id);
  }

  @Post('threads/:threadId/subthreads')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建子贴（仅 OWNER/COLLABORATOR）' })
  async create(
    @Param('threadId') threadId: string,
    @Body() dto: CreateSubthreadDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.subthreadsService.create(threadId, dto, user.id);
  }

  @Get('subthreads/:id')
  @OptionalAuth()
  @ApiOperation({ summary: '获取子贴详情' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req.user as { id: string } | undefined;
    return this.subthreadsService.findById(id, user?.id);
  }

  @Put('threads/:threadId/subthreads/reorder')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '批量重排子贴（拖拽排序）。默认子贴必须在第一位' })
  async reorder(
    @Param('threadId') threadId: string,
    @Body() dto: ReorderSubthreadsDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.subthreadsService.reorder(threadId, dto.ids, user.id);
  }

  @Patch('subthreads/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改子贴（仅 OWNER/COLLABORATOR）' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSubthreadDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.subthreadsService.update(id, dto, user.id);
  }

  @Delete('subthreads/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除子贴（仅 OWNER/COLLABORATOR）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '子贴已删除' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.subthreadsService.remove(id, user.id);
    return { message: '子贴已删除' };
  }
}
