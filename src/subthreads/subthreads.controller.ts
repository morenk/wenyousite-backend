import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { SubthreadsService } from './subthreads.service';
import { CreateSubthreadDto } from './dto/create-subthread.dto';
import { UpdateSubthreadDto } from './dto/update-subthread.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

/** 子贴控制器：列表、创建、详情、修改、删除 */
@ApiTags('Subthreads')
@Controller()
export class SubthreadsController {
  constructor(private subthreadsService: SubthreadsService) {}

  @Get('threads/:threadId/subthreads')
  @Public()
  @ApiOperation({ summary: '获取主题帖下的子贴列表' })
  async findAll(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    const user = (req as any).user as { id: string } | undefined;
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
  @Public()
  @ApiOperation({ summary: '获取子贴详情' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = (req as any).user as { id: string } | undefined;
    return this.subthreadsService.findById(id, user?.id);
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
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.subthreadsService.remove(id, user.id);
    return { message: '子贴已删除' };
  }
}
