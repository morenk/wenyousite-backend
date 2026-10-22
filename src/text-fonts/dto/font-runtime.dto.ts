import { ApiProperty } from '@nestjs/swagger';
import { FontRetryPolicyDto } from '../../meta/text-font-runtime-policy.dto';

class DynamicFontNetworkDto {
  @ApiProperty({ enum: [60000] }) windowMs!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 64 }) maxRequests!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 25165824 }) maxBytes!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2 }) maxConcurrent!: number;
  @ApiProperty({ enum: ['idle-with-total-cap'] }) timeoutMode!: 'idle-with-total-cap';
  @ApiProperty({ enum: [15000] }) timeoutMs!: number;
  @ApiProperty({ enum: [600000] }) maxTransferMs!: number;
}

class DynamicFontWebResidencyDto {
  @ApiProperty({ enum: ['lease-lru'] })
  mode!: 'lease-lru';
  @ApiProperty({ enum: ['document'] })
  scope!: 'document';
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 64 })
  maxFaces!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 16777216 })
  maxSfntBytes!: number;
}
class DynamicFontWebRuntimeDto {
  @ApiProperty({ type: DynamicFontNetworkDto })
  network!: DynamicFontNetworkDto;
  @ApiProperty({
    type: DynamicFontWebResidencyDto,
    description: '没有固定家族数量限制；未释放的 face 继续计费。',
  })
  residency!: DynamicFontWebResidencyDto;
}
class DynamicFontRegistrationDto {
  @ApiProperty({ enum: ['append-only'] })
  mode!: 'append-only';
  @ApiProperty({ enum: ['engine'] })
  scope!: 'engine';
  @ApiProperty({ enum: ['asset-sha256-and-family'] })
  key!: 'asset-sha256-and-family';
  @ApiProperty({ enum: [1] })
  maxAttemptsPerKey!: 1;
  @ApiProperty({ enum: ['quarantine-and-retain-charge'] })
  failedAttempt!: 'quarantine-and-retain-charge';
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1024 })
  maxKeys!: number;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 67108864,
    description:
      '含失败尝试的累计输入 SFNT 字节；不是 RSS。客户端只接受收紧，不能扩大或随目录更新清账。',
  })
  maxInputBytes!: number;
}
class DynamicFontMobileRuntimeDto {
  @ApiProperty({ type: DynamicFontNetworkDto })
  network!: DynamicFontNetworkDto;
  @ApiProperty({ type: DynamicFontRegistrationDto })
  registration!: DynamicFontRegistrationDto;
}
class FontMetadataPolicyDto {
  @ApiProperty({ enum: [300000] })
  revalidateAfterMs!: number;
  @ApiProperty({ enum: [30000] })
  negativeCacheMs!: number;
  @ApiProperty({ enum: [65536] })
  reservationBytes!: number;
  @ApiProperty({ enum: [true] })
  revalidateOnForeground!: true;
  @ApiProperty({ enum: [true] })
  revalidateOnPickerOpen!: true;
  @ApiProperty({ enum: [true] })
  coalesceUnknownVersions!: true;
}
export class DynamicFontRuntimePolicyDto {
  @ApiProperty({
    enum: [3],
    description:
      '动态策略独立于旧固定 manifest 策略 v2。拒绝未知/缺字段策略，保留最后可信策略且不得放大本地硬上限。',
  })
  policyVersion!: 3;
  @ApiProperty({ enum: [2] })
  fontVersion!: 2;
  @ApiProperty({ type: DynamicFontWebRuntimeDto })
  web!: DynamicFontWebRuntimeDto;
  @ApiProperty({ type: DynamicFontMobileRuntimeDto })
  mobile!: DynamicFontMobileRuntimeDto;
  @ApiProperty({ type: FontRetryPolicyDto })
  retry!: FontRetryPolicyDto;
  @ApiProperty({ type: FontMetadataPolicyDto })
  metadata!: FontMetadataPolicyDto;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 67108864 })
  diskCacheBytes!: number;
}
