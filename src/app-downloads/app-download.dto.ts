import { ApiProperty } from '@nestjs/swagger';

export class AndroidDownloadReleaseDto {
  @ApiProperty({ enum: ['android'] }) platform!: 'android';
  @ApiProperty({ example: 'site.wenyou.app' }) applicationId!: string;
  @ApiProperty({ example: '0.3.0-dev.36' }) versionName!: string;
  @ApiProperty({ minimum: 1, maximum: 2100000000 }) buildNumber!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 536870912 }) sizeBytes!: number;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' }) sha256!: string;
  @ApiProperty({ example: 'wenyou-0.3.0-dev.36-42.apk' }) fileName!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({ example: 'https://wenyou.site/api/v1/app-downloads/android/42/file' })
  downloadUrl!: string;
  @ApiProperty({ example: 'https://wenyou.site/api/v1/mobile-releases/android/42' })
  releaseNotesUrl!: string;
}

export class AndroidDownloadInfoDto {
  @ApiProperty({ enum: ['available', 'no_release', 'withdrawn', 'paused', 'unavailable'] })
  status!: 'available' | 'no_release' | 'withdrawn' | 'paused' | 'unavailable';
  @ApiProperty({
    type: AndroidDownloadReleaseDto,
    nullable: true,
    description: '仅 available 含已校验制品，其余状态为 null',
  })
  release!: AndroidDownloadReleaseDto | null;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    nullable: true,
    description: '建议等待秒数，无确定重试时间为 null',
  })
  retryAfterSeconds!: number | null;
}
