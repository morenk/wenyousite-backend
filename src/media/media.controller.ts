import { Controller, Post, Get, Param, Body, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { MediaService } from './media.service';
import { CreateUploadUrlDto, ConfirmUploadDto } from './dto/upload.dto';
import {
  ConfirmUploadResponseDto,
  MediaResponseDto,
  UploadUrlResponseDto,
} from './dto/media-response.dto';
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
  @ApiCreatedResponse({
    type: UploadUrlResponseDto,
    description: '预签名 URL 和 mediaId（UPLOADING 状态）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '文件类型不支持或超过大小限制' })
  @ApiTooManyRequestsResponse({ description: '每用户小时上传配额超限（默认 60 次）' })
  async getUploadUrl(@Req() req: FastifyRequest, @Body() dto: CreateUploadUrlDto) {
    const user = req['user'] as { id: string };
    return this.mediaService.getUploadUrl({ ...dto, userId: user.id });
  }

  /** 上传完成确认：校验 S3 对象存在 + 归属，转 PROCESSING 并入队缩略图生成 */
  @Post('upload-done')
  @ApiOperation({ summary: '确认上传完成（校验归属 + S3，入队异步图片处理）' })
  @ApiOkResponse({ type: ConfirmUploadResponseDto, description: '确认结果（转 PROCESSING 状态）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '媒体状态或对象元数据无效' })
  @ApiNotFoundResponse({
    description: '对象尚不存在或上传未完成（MEDIA_OBJECT_MISSING）',
  })
  async confirmUpload(@Req() req: FastifyRequest, @Body() dto: ConfirmUploadDto) {
    const user = req['user'] as { id: string };
    return this.mediaService.confirmUpload(dto.mediaId, user.id);
  }

  /** 直传失败或签名过期时，为同一媒体记录重新签发 PUT 地址。 */
  @Post(':id/upload-url')
  @ApiOperation({ summary: '为同一 UPLOADING 媒体重新签发临时上传地址' })
  @ApiOkResponse({ type: UploadUrlResponseDto, description: '同一 mediaId 的新预签名 PUT 地址' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '媒体状态不允许重新上传' })
  @ApiNotFoundResponse({ description: '媒体记录不存在' })
  async reissueUploadUrl(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req['user'] as { id: string };
    return this.mediaService.reissueUploadUrl(id, user.id);
  }

  /** 查询图片处理状态，客户端可轮询获知缩略图是否就绪 */
  @Get(':id')
  @ApiOperation({ summary: '查询图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED）' })
  @ApiOkResponse({
    type: MediaResponseDto,
    description: '图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '图片记录不存在或不属于当前用户' })
  async getMedia(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req['user'] as { id: string };
    return this.mediaService.getMedia(id, user.id);
  }
}
