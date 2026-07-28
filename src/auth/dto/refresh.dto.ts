import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Token 刷新请求 DTO：用 refreshToken 换取新的 accessToken（Cookie 优先） */
export class RefreshDto {
  @ApiPropertyOptional({ description: '刷新令牌（Cookie 中已有则无需传）' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
