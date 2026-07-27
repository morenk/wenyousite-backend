import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** Token 刷新请求 DTO：用 refreshToken 换取新的 accessToken */
export class RefreshDto {
  @ApiProperty({ description: '刷新令牌（7 天有效期）' })
  @IsString()
  refreshToken: string;
}
