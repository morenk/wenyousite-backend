import { ApiProperty } from '@nestjs/swagger';

/** 用户公开信息（不含密码等敏感字段） */
export class UserProfile {
  @ApiProperty({ example: 'clxabc123def456', description: '用户 ID' })
  id: string;

  @ApiProperty({ example: 'user@example.com', description: '邮箱地址' })
  email: string;

  @ApiProperty({ example: 'zhangsan', description: '用户名' })
  username: string;

  @ApiProperty({ example: 'https://cdn.example.com/avatars/abc.jpg', required: false, nullable: true, description: '头像 URL' })
  avatar?: string | null;

  @ApiProperty({ example: 'USER', description: '用户角色（USER / ADMIN / SUPER_ADMIN）' })
  role: string;

  @ApiProperty({ example: true, description: '邮箱是否已验证' })
  emailVerified: boolean;
}

/** 认证响应 DTO：双 Token + 用户基本信息 */
export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbHhhYmMxMjMiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDkwMH0.abc123def456', description: '访问令牌（15 分钟有效期），后续请求放在 Authorization: Bearer <token> 头' })
  accessToken: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: '刷新令牌（web 7 天 / mobile 30 天有效期），用于 /auth/refresh 刷新 accessToken' })
  refreshToken: string;

  @ApiProperty({ description: '当前登录用户信息' })
  user: UserProfile;
}
