import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { OptionalAuth } from '../auth/decorators/auth.decorator';
import { GalleryQueryDto, GalleryPageDto } from './gallery.dto';
import { GalleryService } from './gallery.service';
@ApiTags('Image Gallery')
@Controller('image-gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}
  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: '从点击图片锚点双向浏览当前阅读范围的普通图片' })
  @ApiOkResponse({ type: GalleryPageDto })
  @ApiBadRequestResponse({ description: '查询参数或游标无效' })
  @ApiNotFoundResponse({ description: '阅读范围或图片不存在/不可见' })
  @ApiConflictResponse({ description: '图片锚点已变化，或历史索引尚未就绪，请重新加载' })
  list(@Query() query: GalleryQueryDto, @Req() req: FastifyRequest) {
    return this.gallery.list(query, req.user?.id);
  }
}
