import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';

class ApiCapabilitiesResponseDto {
  @ApiProperty()
  stickers!: boolean;

  @ApiProperty()
  directMessages!: boolean;

  @ApiProperty()
  pushNotifications!: boolean;
}

class MobilePlatformCompatibilityDto {
  @ApiProperty({ type: Number, nullable: true, example: 120 })
  minimumSupportedBuild!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 135 })
  recommendedBuild!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'https://wenyou.site/download' })
  updateUrl!: string | null;
}

class MobileCompatibilityDto {
  @ApiProperty({ type: MobilePlatformCompatibilityDto })
  android!: MobilePlatformCompatibilityDto;

  @ApiProperty({ type: MobilePlatformCompatibilityDto })
  ios!: MobilePlatformCompatibilityDto;
}

class ApiMetaResponseDto {
  @ApiProperty()
  contractVersion!: string;

  @ApiProperty({ type: String, nullable: true })
  buildSha!: string | null;

  @ApiProperty({ example: 4 })
  markdownContractVersion!: number;

  @ApiProperty({ type: ApiCapabilitiesResponseDto })
  capabilities!: ApiCapabilitiesResponseDto;

  @ApiProperty({ type: MobileCompatibilityDto })
  mobileCompatibility!: MobileCompatibilityDto;
}

/** 客户端启动时可读取的稳定协议元数据。 */
@ApiTags('Meta')
@Controller('meta')
export class MetaController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: ApiMetaResponseDto })
  getMeta(): ApiMetaResponseDto {
    return {
      contractVersion: API_CONTRACT_VERSION,
      buildSha: this.config.get<string>('app.buildSha') ?? null,
      markdownContractVersion: 4,
      capabilities: {
        stickers: true,
        directMessages: true,
        pushNotifications: this.config.get<boolean>('push.enabled') ?? false,
      },
      mobileCompatibility: {
        android: this.platformCompatibility('android'),
        ios: this.platformCompatibility('ios'),
      },
    };
  }

  private platformCompatibility(platform: 'android' | 'ios'): MobilePlatformCompatibilityDto {
    const prefix = `mobileCompatibility.${platform}`;
    return {
      minimumSupportedBuild: this.config.get<number>(`${prefix}.minimumSupportedBuild`) ?? null,
      recommendedBuild: this.config.get<number>(`${prefix}.recommendedBuild`) ?? null,
      updateUrl: this.config.get<string>(`${prefix}.updateUrl`) ?? null,
    };
  }
}
