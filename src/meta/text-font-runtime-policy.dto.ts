import { ApiProperty } from '@nestjs/swagger';

class FontNetworkWindowDto {
  @ApiProperty({ enum: [60000], description: '滚动时间窗口；续额不重置驻留或原生注册账本' })
  windowMs!: number;
  @ApiProperty({ enum: [64], description: '包含元数据、通知文件、失败和重试的请求预留次数' })
  maxRequests!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 25165824, description: '窗口预留字节；所有当前分片与通知均使用此额度' })
  maxBytes!: number;
  @ApiProperty({ enum: [1, 2] })
  maxConcurrent!: number;
  @ApiProperty({ enum: ['idle-with-total-cap'], description: '仅非空正文数据块重置 idle；响应头及空块不算进度，排队不计时' })
  timeoutMode!: 'idle-with-total-cap';
  @ApiProperty({ enum: [15000], description: '实际请求开始后等待首个有效字节、以及连续无有效字节进度的时限；不是总传输时限' })
  timeoutMs!: number;
  @ApiProperty({ enum: [600000], description: '从实际请求开始到响应体结束的独立总时限，持续有进度也不得续期；元数据与字体均适用' })
  maxTransferMs!: number;
}

class FontWebResidencyDto {
  @ApiProperty({ enum: ['lease-lru'] })
  mode!: 'lease-lru';
  @ApiProperty({ enum: ['document'], description: '同一文档的多个阅读窗口共用一个运行时' })
  scope!: 'document';
  @ApiProperty({ enum: [28], description: '当前目录全部家族均可参与活动集合，不是历史累计次数' })
  maxFamilies!: number;
  @ApiProperty({ enum: [64], description: '活动与待注册 face 数；只有实际解除注册并释放引用后才归还' })
  maxFaces!: number;
  @ApiProperty({ enum: [16777216], description: '普通片按移动 SFNT 字节预占；经哈希校验后与 WOFF2.totalSfntSize 取较大值，解码前补足；不是压缩字节或引擎 RSS' })
  maxSfntBytes!: number;
}

class FontWebRuntimeDto {
  @ApiProperty({ type: FontNetworkWindowDto })
  network!: FontNetworkWindowDto;
  @ApiProperty({ type: FontWebResidencyDto })
  residency!: FontWebResidencyDto;
}

class FontRegistrationSnapshotDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1024, description: '按 mobile 资产 SHA 去重的全集数量' })
  assetCount!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 268435456, description: '去重 SFNT 文件字节之和，不是 native 内存上限' })
  totalAssetBytes!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1024, description: '按资产 SHA＋family 去重的注册全集数量' })
  registrationCount!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 268435456, description: '按注册键汇总输入字节，防止同资产多别名绕过账本' })
  totalRegistrationAssetBytes!: number;
}

class FontSnapshotSafetyCeilingDto {
  @ApiProperty({ enum: [1024], description: '消费者本地固定接受边界，不能直接服从远端扩大' })
  maxSnapshotAssets!: number;
  @ApiProperty({ enum: [268435456], description: '消费者本地固定注册输入边界，不代表设备内存安全' })
  maxSnapshotAssetBytes!: number;
}

class FontMobileRegistrationDto {
  @ApiProperty({ enum: ['fixed-manifest'] })
  mode!: 'fixed-manifest';
  @ApiProperty({ enum: ['engine'] })
  scope!: 'engine';
  @ApiProperty({ enum: ['asset-sha256-and-family'] })
  key!: 'asset-sha256-and-family';
  @ApiProperty({ enum: [1], description: '原生调用前登记；同键最多调用一次，下载失败不算原生尝试' })
  maxAttemptsPerKey!: number;
  @ApiProperty({ enum: ['quarantine-and-retain-charge'], description: '原生失败保留占用和隔离记录，不随重试或目录版本清零' })
  failedAttempt!: 'quarantine-and-retain-charge';
  @ApiProperty({ type: FontRegistrationSnapshotDto })
  snapshot!: FontRegistrationSnapshotDto;
  @ApiProperty({ type: FontSnapshotSafetyCeilingDto })
  safetyCeiling!: FontSnapshotSafetyCeilingDto;
}

class FontMobileRuntimeDto {
  @ApiProperty({ type: FontNetworkWindowDto })
  network!: FontNetworkWindowDto;
  @ApiProperty({ type: FontMobileRegistrationDto })
  registration!: FontMobileRegistrationDto;
}

class FontRetryPolicyDto {
  @ApiProperty({ type: [Number], description: '第 n 次连续暂时失败的抖动上限；末项持续复用，成功后清零' })
  delayCeilingsMs!: number[];
  @ApiProperty({ enum: ['full'], description: 'floor(U×(ceiling+1))，U∈[0,1)；Retry-After 与窗口等待取更晚时间' })
  jitter!: 'full';
  @ApiProperty({ type: [Number], description: '仅 408、429、500、502、503、504 视为暂时 HTTP 错误' })
  retryableHttpStatuses!: number[];
  @ApiProperty({ enum: [true] })
  retryNetworkErrors!: boolean;
  @ApiProperty({ enum: [true] })
  retryTimeouts!: boolean;
  @ApiProperty({ enum: [true] })
  respectRetryAfter!: boolean;
}

export class TextFontRuntimePolicyDto {
  @ApiProperty({ enum: [2], description: '独立运行策略；未识别版本时继续 legacy limits' })
  policyVersion!: 2;
  @ApiProperty({ pattern: '^[a-f0-9]{64}$', description: '必须等于已校验目录描述符和 manifest 实际 SHA；不匹配不启用策略' })
  manifestSha256!: string;
  @ApiProperty({ type: FontWebRuntimeDto })
  web!: FontWebRuntimeDto;
  @ApiProperty({ type: FontMobileRuntimeDto })
  mobile!: FontMobileRuntimeDto;
  @ApiProperty({ type: FontRetryPolicyDto })
  retry!: FontRetryPolicyDto;
}
