import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Auth, OptionalAuth } from '../auth/decorators/auth.decorator';
import { AddThreadTagDto } from './dto/add-thread-tag.dto';
import { ThreadTagsService } from './thread-tags.service';
import { MessageResponseDto } from '../common/dto/message-response.dto';

@ApiTags('Threads')
@Controller('threads/:threadId/tags')
export class ThreadTagsController {
  constructor(private readonly tags: ThreadTagsService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: '获取主题帖关联的标签列表' })
  findAll(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    return this.tags.findAll(threadId, (req['user'] as { id: string } | undefined)?.id);
  }

  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '为主题帖添加标签（仅 OWNER/COLLABORATOR）' })
  add(@Param('threadId') threadId: string, @Body() dto: AddThreadTagDto, @Req() req: FastifyRequest) {
    return this.tags.add(threadId, dto.name, (req['user'] as { id: string }).id);
  }

  @Delete(':tagId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移除主题帖的标签（仅 OWNER/COLLABORATOR）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '标签已移除' })
  remove(
    @Param('threadId') threadId: string,
    @Param('tagId') tagId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.tags.remove(threadId, tagId, (req['user'] as { id: string }).id);
  }
}
