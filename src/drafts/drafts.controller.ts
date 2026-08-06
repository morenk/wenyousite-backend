import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { DraftsService } from './drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import {
  DeleteDraftResponseDto,
  DraftResponseDto,
  DraftSlotUsageResponseDto,
} from './dto/draft-response.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';

/** 草稿控制器：用户级 5 槽位全局草稿池 */
@ApiTags('Drafts')
@Controller('drafts')
@ApiBearerAuth()
export class DraftsController {
  constructor(private draftsService: DraftsService) {}

  @Get()
  @AuthRead()
  @ApiOperation({ summary: '当前用户全部草稿' })
  @ApiOkResponse({ type: DraftResponseDto, isArray: true, description: '当前用户全部草稿' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async findAll(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.findAll(user.id);
  }

  @Get('slots')
  @AuthRead()
  @ApiOperation({ summary: '草稿位使用情况（5 槽已用数）' })
  @ApiOkResponse({ type: DraftSlotUsageResponseDto, description: '草稿位使用情况（5 槽已用数）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async slotUsage(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.slotUsage(user.id);
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: '保存草稿（不传 slot 自动选空闲位）' })
  @ApiCreatedResponse({ type: DraftResponseDto, description: '创建的草稿' })
  @ApiConflictResponse({ description: '覆盖已有槽位时 version 缺失或已过期' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async create(@Body() dto: CreateDraftDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.create(dto, user.id);
  }

  @Get(':id')
  @AuthRead()
  @ApiOperation({ summary: '获取单条草稿' })
  @ApiOkResponse({ type: DraftResponseDto, description: '草稿详情' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '草稿不存在' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.findById(id, user.id);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: '更新草稿内容' })
  @ApiOkResponse({ type: DraftResponseDto, description: '更新后的草稿' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '草稿不存在' })
  @ApiConflictResponse({ description: 'version 已过期' })
  async update(@Param('id') id: string, @Body() dto: UpdateDraftDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.draftsService.update(id, dto.content, dto.version, user.id);
  }

  @Delete(':id')
  @Auth()
  @ApiOperation({ summary: '删除草稿' })
  @ApiOkResponse({ type: DeleteDraftResponseDto, description: '草稿已删除' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '草稿不存在' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.draftsService.remove(id, user.id);
    return { message: '草稿已删除' };
  }
}
