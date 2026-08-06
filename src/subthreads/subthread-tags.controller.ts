import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Auth, OptionalAuth } from '../auth/decorators/auth.decorator';
import { AddSubthreadTagDto } from './dto/add-subthread-tag.dto';
import { SubthreadTagsService } from './subthread-tags.service';
import { MessageResponseDto } from '../common/dto/message-response.dto';

@ApiTags('Subthreads')
@Controller('subthreads/:subthreadId/tags')
export class SubthreadTagsController {
  constructor(private readonly tags: SubthreadTagsService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: '获取子贴的标签列表' })
  findAll(@Param('subthreadId') subthreadId: string, @Req() req: FastifyRequest) {
    return this.tags.findAll(subthreadId, (req['user'] as { id: string } | undefined)?.id);
  }

  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '为子贴添加标签（仅 OWNER/COLLABORATOR）' })
  add(
    @Param('subthreadId') subthreadId: string,
    @Body() dto: AddSubthreadTagDto,
    @Req() req: FastifyRequest,
  ) {
    return this.tags.add(subthreadId, dto, (req['user'] as { id: string }).id);
  }

  @Delete(':tagId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移除子贴的标签（仅 OWNER/COLLABORATOR）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '标签已移除' })
  remove(
    @Param('subthreadId') subthreadId: string,
    @Param('tagId') tagId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.tags.remove(subthreadId, tagId, (req['user'] as { id: string }).id);
  }
}
