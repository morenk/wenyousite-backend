import { ApiProperty } from '@nestjs/swagger';
import { CLIENT_PLATFORMS, ClientPlatform } from '../client-platform';

/** 登录终端响应：一个账号最多同时保留 Web 与移动客户端各一个终端。 */
export class SessionResponseDto {
  @ApiProperty({
    example: '80c3c7f7-4eb2-4747-8e27-a5ea6bc64167',
    description: '稳定的登录终端标识；refresh token 轮转时保持不变',
  })
  id: string;

  @ApiProperty({
    enum: CLIENT_PLATFORMS,
    example: 'web',
    description: '终端平台：web=浏览器，mobile=原生移动客户端',
  })
  platform: ClientPlatform;

  @ApiProperty({
    type: String,
    nullable: true,
    deprecated: true,
    example: 'Mozilla/5.0 ...',
    description: '原始客户端标识，仅为旧客户端兼容保留；界面不得直接展示',
  })
  deviceInfo: string | null;

  @ApiProperty({ example: true, description: '是否为发起当前请求的登录终端' })
  isCurrent: boolean;

  @ApiProperty({
    format: 'date-time',
    example: '2026-08-05T09:00:00.000Z',
    description: '本次终端登录的开始时间，refresh token 轮转时保持不变',
  })
  signedInAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-08-05T09:15:00.000Z',
    description: '最近一次登录或令牌续期时间',
  })
  lastActiveAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-08-12T09:15:00.000Z',
    description: '当前 refresh token 的过期时间',
  })
  expiresAt: Date;

  @ApiProperty({
    format: 'date-time',
    deprecated: true,
    example: '2026-08-05T09:00:00.000Z',
    description: '兼容旧客户端的登录时间别名；新客户端请使用 signedInAt',
  })
  createdAt: Date;
}

export class RevokeSessionResponseDto {
  @ApiProperty({ example: '登录终端已退出' })
  message: string;
}
