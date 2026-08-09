import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 登出 DTO：当前终端优先由 access token 的 sid 识别，refreshToken 用于旧客户端兼容。 */
export class LogoutDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: '旧客户端兼容：待撤销的刷新令牌；当前 access token 含 sid 时可省略' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
