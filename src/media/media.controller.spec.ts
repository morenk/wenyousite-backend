/** 媒体控制器契约测试：保证编辑器上传端点声明完整 Swagger 响应 DTO */

import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger';
import { MediaController } from './media.controller';
import {
  ConfirmUploadResponseDto,
  MediaResponseDto,
  UploadUrlResponseDto,
} from './dto/media-response.dto';

function responseMetadata(method: keyof MediaController) {
  return Reflect.getMetadata(
    DECORATORS.API_RESPONSE,
    MediaController.prototype[method],
  ) as Record<number, { type?: unknown }>;
}

describe('MediaController Swagger 响应契约', () => {
  it('upload-url 声明 UploadUrlResponseDto', () => {
    expect(responseMetadata('getUploadUrl')[201].type).toBe(UploadUrlResponseDto);
  });

  it('upload-done 声明 ConfirmUploadResponseDto', () => {
    expect(responseMetadata('confirmUpload')[200].type).toBe(ConfirmUploadResponseDto);
  });

  it('状态查询声明 MediaResponseDto', () => {
    expect(responseMetadata('getMedia')[200].type).toBe(MediaResponseDto);
  });
});
