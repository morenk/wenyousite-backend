import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import {
  ImportStickerDirectMessageDto,
  ImportStickerMediaDto,
  ImportStickerPostImageDto,
  ReorderStickersDto,
  StickerCollectionResponseDto,
  StickerImportResponseDto,
} from './dto/sticker.dto';
import { StickersService } from './stickers.service';

@ApiTags('Stickers')
@ApiBearerAuth()
@Controller('stickers')
export class StickersController {
  constructor(private readonly stickers: StickersService) {}

  @Get()
  @AuthRead()
  @ApiOperation({ summary: '获取当前用户收藏、最近使用和处理中的表情' })
  @ApiOkResponse({ type: StickerCollectionResponseDto })
  getCollection(@Req() req: FastifyRequest) {
    return this.stickers.getCollection((req.user as { id: string }).id);
  }

  @Post('imports/media')
  @Auth()
  @ApiOperation({ summary: '将自己已上传的站内图片导入表情收藏' })
  @ApiCreatedResponse({ type: StickerImportResponseDto })
  importMedia(@Req() req: FastifyRequest, @Body() dto: ImportStickerMediaDto) {
    return this.stickers.importMedia((req.user as { id: string }).id, dto);
  }

  @Post('imports/direct-message')
  @Auth()
  @ApiOperation({ summary: '收藏私聊消息中的图片或表情' })
  @ApiCreatedResponse({ type: StickerImportResponseDto })
  importDirectMessage(
    @Req() req: FastifyRequest,
    @Body() dto: ImportStickerDirectMessageDto,
  ) {
    return this.stickers.importDirectMessage((req.user as { id: string }).id, dto);
  }

  @Post('imports/post-image')
  @Auth()
  @ApiOperation({ summary: '收藏可访问帖子正文中的站内图片或表情' })
  @ApiCreatedResponse({ type: StickerImportResponseDto })
  importPostImage(@Req() req: FastifyRequest, @Body() dto: ImportStickerPostImageDto) {
    return this.stickers.importPostImage((req.user as { id: string }).id, dto);
  }

  @Get('imports/:id')
  @AuthRead()
  @ApiOperation({ summary: '查询单次表情导入处理状态' })
  @ApiOkResponse({ type: StickerImportResponseDto })
  getImport(@Req() req: FastifyRequest, @Param('id') id: string) {
    return this.stickers.getImport((req.user as { id: string }).id, id);
  }

  @Put('reorder')
  @Auth()
  @ApiOperation({ summary: '按完整 ID 列表手动重排收藏' })
  @ApiOkResponse({ type: StickerCollectionResponseDto })
  reorder(@Req() req: FastifyRequest, @Body() dto: ReorderStickersDto) {
    return this.stickers.reorder((req.user as { id: string }).id, dto);
  }

  @Delete(':favoriteId')
  @Auth()
  @ApiOperation({ summary: '从自己的收藏夹移除表情' })
  @ApiOkResponse({ type: StickerCollectionResponseDto })
  remove(@Req() req: FastifyRequest, @Param('favoriteId') favoriteId: string) {
    return this.stickers.remove((req.user as { id: string }).id, favoriteId);
  }
}
