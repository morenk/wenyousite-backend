import { Controller, Post, Get, Param, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse, ApiUnauthorizedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { MediaService } from './media.service';
import { CreateUploadUrlDto, ConfirmUploadDto } from './dto/upload.dto';
import { Auth } from '../auth/decorators/auth.decorator';

/** 媒体上传控制器：预签名 URL 生成 + 上传完成确认 + 异步图片处理 + 状态查询 */
@ApiTags('Media')
@Controller('media')
@Auth()
@ApiBearerAuth()
export class MediaController {
  constructor(private mediaService: MediaService) {}

  /** 获取 S3 预签名上传 URL 并预建 Media 记录，客户端凭此直传对象存储 */
  @Post('upload-url')
  @ApiOperation({ summary: '获取临时上传 URL + mediaId（有效期 10 分钟，预建 UPLOADING 记录）' })
  @ApiCreatedResponse({ description: '预签名 URL 和 mediaId（UPLOADING 状态）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '文件类型不支持或超过大小限制' })
  @ApiTooManyRequestsResponse({ description: '每用户小时上传配额超限（默认 60 次）' })
  async getUploadUrl(
    @Req() req: FastifyRequest,
    @Body() dto: CreateUploadUrlDto,
  ) {
    const user = req['user'] as { id: string };
    return this.mediaService.getUploadUrl({ ...dto, userId: user.id });
  }

  /** 上传完成确认：校验 S3 对象存在 + 归属，转 PROCESSING 并入队缩略图生成 */
  @Post('upload-done')
  @ApiOperation({ summary: '确认上传完成（校验归属 + S3，入队异步图片处理）' })
  @ApiOkResponse({ description: '确认结果（转 PROCESSING 状态）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '文件不存在或不属于当前用户' })
  async confirmUpload(
    @Req() req: FastifyRequest,
    @Body() dto: ConfirmUploadDto,
  ) {
    const user = req['user'] as { id: string };
    return this.mediaService.confirmUpload(dto.mediaId, user.id);
  }

  /** 查询图片处理状态，客户端可轮询获知缩略图是否就绪 */
  @Get(':id')
  @ApiOperation({ summary: '查询图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED）' })
  @ApiOkResponse({ description: '图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED），含缩略图 URL' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '图片记录不存在或不属于当前用户' })
  async getMedia(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    const user = req['user'] as { id: string };
    return this.mediaService.getMedia(id, user.id);
  }
}
