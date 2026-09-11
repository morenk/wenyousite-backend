import { ApiProperty } from '@nestjs/swagger';

/** 展示地址与持久引用身份分离；仅描述已验证并成功发布的完整 WebP。 */
export class MediaDisplayResponseDto {
  @ApiProperty({ description: '可信完整展示资源；不得据来源 URL 猜测或改写扩展名' })
  url!: string;

  @ApiProperty({ enum: ['image/webp'] })
  contentType!: 'image/webp';

  @ApiProperty({ minimum: 1 })
  width!: number;

  @ApiProperty({ minimum: 1 })
  height!: number;

  @ApiProperty({ minimum: 1 })
  bytes!: number;

  @ApiProperty()
  animated!: boolean;

  @ApiProperty({ minimum: 1, description: '静态图为 1；动画必须保留全部帧' })
  frameCount!: number;

  @ApiProperty({ minimum: 0, description: '完整单轮时长；静态图为 0' })
  durationMs!: number;

  @ApiProperty({ minimum: 0, description: '0 无限循环，1 播放一次；静态图固定 1' })
  loopCount!: number;
}

export class MarkdownMediaDisplayResponseDto {
  @ApiProperty({ description: '正文精确来源 URL；编辑、引用和收藏继续持久化此身份' })
  sourceUrl!: string;

  @ApiProperty({ type: MediaDisplayResponseDto, nullable: true, description: '历史未补处理或无法确认时为空' })
  display!: MediaDisplayResponseDto | null;
}
