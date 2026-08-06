import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 用户公开信息（不含密码等敏感字段） */
export class UserProfile {
  @ApiProperty({ example: 'clxabc123def456', description: '用户 ID' })
  id: string;

  @ApiProperty({ example: 'user@example.com', description: '邮箱地址' })
  email: string;

  @ApiProperty({ example: 'zhangsan', description: '用户名' })
  username: string;

  @ApiProperty({ type: String, example: 'https://cdn.example.com/avatars/abc.jpg', nullable: true, description: '头像 URL' })
  avatar: string | null;

  @ApiProperty({ example: 'USER', description: '用户角色（USER / ADMIN / SUPER_ADMIN）' })
  role: string;

  @ApiProperty({ example: true, description: '邮箱是否已验证' })
  emailVerified: boolean;
}

/** 认证响应 DTO：Web 使用 httpOnly Cookie，移动客户端从响应体取得 refresh token。 */
export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbHhhYmMxMjMiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDkwMH0.abc123def456', description: '访问令牌（15 分钟有效期），后续请求放在 Authorization: Bearer <token> 头' })
  accessToken: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: '仅移动客户端返回；Web 端通过 httpOnly Cookie 接收（mobile 30 天有效期）' })
  refreshToken?: string;

  @ApiProperty({ description: '当前登录用户信息' })
  user: UserProfile;

  @ApiPropertyOptional({ example: '注册成功', description: '仅完成注册时返回的提示文案' })
  message?: string;
}

export class RegisterCodeResponseDto {
  @ApiProperty()
  emailSent!: boolean;

  @ApiProperty({ example: 900, description: '验证码有效秒数' })
  codeExpiresIn!: number;

  @ApiProperty()
  message!: string;
}
