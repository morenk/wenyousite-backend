import { ApiProperty } from '@nestjs/swagger';

/** 用户公开信息（不含密码等敏感字段） */
class UserProfile {
  @ApiProperty({ description: '用户 ID' })
  id: string;

  @ApiProperty({ description: '邮箱地址' })
  email: string;

  @ApiProperty({ description: '用户名' })
  username: string;

  @ApiProperty({ required: false, description: '昵称' })
  nickname?: string;

  @ApiProperty({ required: false, description: '头像 URL' })
  avatar?: string;

  @ApiProperty({ description: '用户角色（USER / ADMIN）' })
  role: string;

  @ApiProperty({ description: '邮箱是否已验证' })
  emailVerified: boolean;
}

/** 认证响应 DTO：双 Token + 用户基本信息 */
export class AuthResponseDto {
  @ApiProperty({ description: '访问令牌（15 分钟有效期）' })
  accessToken: string;

  @ApiProperty({ description: '刷新令牌（7 天有效期）' })
  refreshToken: string;

  @ApiProperty({ description: '当前用户信息' })
  user: UserProfile;
}
