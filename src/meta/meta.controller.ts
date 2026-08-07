import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';

class ApiCapabilitiesResponseDto {
  @ApiProperty()
  stickers!: boolean;

  @ApiProperty()
  directMessages!: boolean;

  @ApiProperty()
  pushNotifications!: boolean;
}

class ApiMetaResponseDto {
  @ApiProperty()
  contractVersion!: string;

  @ApiProperty({ type: String, nullable: true })
  buildSha!: string | null;

  @ApiProperty({ example: 2 })
  markdownContractVersion!: number;

  @ApiProperty({ type: ApiCapabilitiesResponseDto })
  capabilities!: ApiCapabilitiesResponseDto;
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
      markdownContractVersion: 2,
      capabilities: {
        stickers: true,
        directMessages: true,
        pushNotifications: this.config.get<boolean>('push.enabled') ?? false,
      },
    };
  }
}
