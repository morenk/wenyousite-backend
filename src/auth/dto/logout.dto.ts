import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 登出 DTO：传入 refreshToken 撤销指定设备（Cookie 中已有则无需传） */
export class LogoutDto {
  @ApiPropertyOptional({ description: '待撤销的刷新令牌（Cookie 中已有则无需传）' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
