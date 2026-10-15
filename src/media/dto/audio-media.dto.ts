import { ApiProperty } from '@nestjs/swagger';
import { AUDIO_CONTENT_TYPES, AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_MS } from '../audio-policy';

/** 只为本次已授权正文内实际绑定的规范音频提供播放描述。 */
export class AudioMediaDto {
  @ApiProperty({ description: '正文普通链接的精确固定 URL；保存继续保留此 URL' })
  sourceUrl!: string;
  @ApiProperty()
  mediaId!: string;
  @ApiProperty({ enum: ['audio/mpeg'] })
  contentType!: 'audio/mpeg';
  @ApiProperty({ minimum: 1, description: '规范播放副本字节数' })
  size!: number;
  @ApiProperty({ minimum: 1, maximum: AUDIO_MAX_DURATION_MS })
  durationMs!: number;
}

export class AudioUploadCapabilityDto {
  @ApiProperty({ enum: [1] })
  version!: 1;
  @ApiProperty({ example: AUDIO_MAX_BYTES })
  maxBytes!: number;
  @ApiProperty({ example: AUDIO_MAX_DURATION_MS })
  maxDurationMs!: number;
  @ApiProperty({ type: [String], enum: AUDIO_CONTENT_TYPES })
  contentTypes!: string[];
  @ApiProperty({ enum: ['audio/mpeg'] })
  outputContentType!: 'audio/mpeg';
}
