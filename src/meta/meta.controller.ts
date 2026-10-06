import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ACTIVE_MARKDOWN_CONTRACT_VERSION } from '../common/markdown-content';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';

class ApiCapabilitiesResponseDto {
  @ApiPropertyOptional({ description: '支持 RP 身份绑定本主题资料楼层及按查看者授权读取；缺失按 false，客户端不得发送 profilePostId/clearProfilePost' })
  rpIdentityProfileSupported?: boolean;
  @ApiPropertyOptional({ description: '支持 header/DTO Markdown 6 能力协商、保源和旧读安全降级；缺失按 false' })
  roleMentionsV6Supported?: boolean;
  @ApiPropertyOptional({ description: '允许创建新的显式 ACCOUNT / RP 提及节点；与全局 Markdown 激活版本独立，缺失按 false' })
  roleMentionsV6WriteEnabled?: boolean;

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

  @ApiProperty({ example: ACTIVE_MARKDOWN_CONTRACT_VERSION })
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
      markdownContractVersion: ACTIVE_MARKDOWN_CONTRACT_VERSION,
      capabilities: {
        rpIdentityProfileSupported: true,
        roleMentionsV6Supported: true,
        roleMentionsV6WriteEnabled: this.config.get<boolean>('app.roleMentionsV6Enabled') ?? false,
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
