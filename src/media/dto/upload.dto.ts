import { MediaPurpose } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  MinLength,
  MaxLength,
  Min,
  Max,
  IsIn,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { MEDIA_PURPOSES } from '../media-policy';

/** 允许上传的图片 MIME 类型 */
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/avif',
] as const;

/** 获取预签名上传 URL 的请求参数 */
export class CreateUploadUrlDto {
  @ApiProperty({ example: 'photo.jpg', description: '原始文件名' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename: string;

  @ApiProperty({ example: 'image/jpeg', enum: ALLOWED_MIME, description: '文件 MIME 类型' })
  @IsString()
  @IsIn(ALLOWED_MIME as unknown as string[])
  contentType: string;

  @ApiProperty({ example: 204800, description: '文件大小（字节），上限 10MB' })
  @IsNumber()
  @Min(1)
  @Max(10 * 1024 * 1024)
  size: number;

  @ApiPropertyOptional({
    enum: MEDIA_PURPOSES,
    default: MediaPurpose.LEGACY,
    description: '图片业务用途；旧客户端省略时按 LEGACY 生成全部兼容派生图',
  })
  @IsOptional()
  @IsEnum(MediaPurpose)
  purpose?: MediaPurpose;
}

/** 上传完成后确认的请求参数，使用 upload-url 返回的 mediaId */
export class ConfirmUploadDto {
  @ApiProperty({ example: 'clx...', description: 'getUploadUrl 返回的 mediaId' })
  @IsString()
  @MinLength(1)
  mediaId: string;
}
