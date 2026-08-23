/** 媒体响应 DTO：供 Web/Flutter 生成上传链路的强类型客户端 */

import { ApiProperty } from '@nestjs/swagger';
import { MediaPurpose } from '@prisma/client';
import { MEDIA_PURPOSES } from '../media-policy';

const MEDIA_STATUSES = ['UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

/** 预签名上传地址响应 */
export class UploadUrlResponseDto {
  @ApiProperty({ description: '对象存储预签名 PUT 地址' })
  uploadUrl!: string;

  @ApiProperty({ description: '媒体记录 ID，后续确认和轮询使用' })
  mediaId!: string;

  @ApiProperty({ description: '本次 PUT 使用的临时对象 key；客户端不得据此拼接读取地址' })
  objectKey!: string;

  @ApiProperty({ description: '处理完成后的正式媒体地址；静态图为归一化母版，GIF 为保留的动画原件' })
  publicUrl!: string;
}

/** 媒体记录响应 */
export class MediaResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ description: '正式媒体地址；静态图为归一化母版，GIF 为保留的动画原件' })
  url!: string;

  @ApiProperty({ type: String, nullable: true, description: '处理完成后的 300px WebP 缩略图地址' })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '处理完成后的 480px 等比例 WebP 信息流图片地址' })
  feedUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '处理完成后的 800px WebP 中图地址' })
  mediumUrl!: string | null;

  @ApiProperty({ description: '对象存储 key' })
  key!: string;

  @ApiProperty({ type: String, nullable: true, description: '经对象存储确认的 MIME 类型；历史记录可能为空' })
  contentType!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: '声明或经确认的文件大小（字节）' })
  size!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ enum: MEDIA_PURPOSES })
  purpose!: MediaPurpose;

  @ApiProperty({ description: '是否为保留动画的 GIF' })
  animated!: boolean;

  @ApiProperty({ enum: MEDIA_STATUSES })
  status!: (typeof MEDIA_STATUSES)[number];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** 上传确认响应 */
export class ConfirmUploadResponseDto {
  @ApiProperty({ type: MediaResponseDto })
  media!: MediaResponseDto;

  @ApiProperty({ description: '是否处于异步图片处理阶段' })
  processing!: boolean;
}
