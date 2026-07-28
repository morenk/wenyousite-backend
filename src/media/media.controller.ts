import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { MediaService } from './media.service';
import { CreateUploadUrlDto, ConfirmUploadDto } from './dto/upload.dto';
import { AuthRead } from '../auth/decorators/auth.decorator';

/** 媒体上传控制器：预签名 URL 生成 + 上传完成确认 + 异步图片处理 */
@ApiTags('Media')
@Controller('media')
@UseGuards(AuthRead())
@ApiBearerAuth()
export class MediaController {
  constructor(private mediaService: MediaService) {}

  /** 获取 S3 预签名上传 URL，客户端凭此直传对象存储 */
  @Post('upload-url')
  @ApiOperation({ summary: '获取临时上传 URL（返回预签名地址，客户端直传对象存储，有效期 10 分钟）' })
  async getUploadUrl(
    @Req() req: FastifyRequest,
    @Body() dto: CreateUploadUrlDto,
  ) {
    const user = req['user'] as { id: string };
    return this.mediaService.getUploadUrl({ ...dto, userId: user.id });
  }

  /** 上传完成确认：客户端 PUT 成功后调用，写入数据库并触发异步缩略图生成 */
  @Post('upload-done')
  @ApiOperation({ summary: '确认上传完成（写入数据库，入队异步图片处理生成缩略图和中图）' })
  async confirmUpload(
    @Req() req: FastifyRequest,
    @Body() dto: ConfirmUploadDto,
  ) {
    const user = req['user'] as { id: string };
    return this.mediaService.confirmUpload(dto.objectKey, user.id);
  }
}
