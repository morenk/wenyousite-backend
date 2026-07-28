import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** 登出 DTO：需要传 refreshToken 以精准撤销指定设备的会话 */
export class LogoutDto {
  @ApiProperty({ description: '待撤销的刷新令牌' })
  @IsString()
  refreshToken: string;
}
