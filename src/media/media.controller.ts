import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Media')
@Controller('media')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MediaController {
  constructor(private mediaService: MediaService) {}

  @Post('upload-url')
  @ApiOperation({ summary: '获取临时上传 URL（客户端直传对象存储）' })
  async getUploadUrl(
    @Req() req: FastifyRequest,
    @Body() dto: { filename: string; contentType: string; size: number },
  ) {
    const user = req['user'] as { id: string };
    return this.mediaService.getUploadUrl({ ...dto, userId: user.id });
  }
}
