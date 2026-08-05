import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 登出 DTO：传入 refreshToken 退出当前登录终端（Cookie 中已有则无需传） */
export class LogoutDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: '待撤销的刷新令牌（Cookie 中已有则无需传）' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
