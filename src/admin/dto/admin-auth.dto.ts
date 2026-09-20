import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class AdminLoginChallengeDto {
  @ApiProperty({ example: 'admin@example.com', description: '管理员邮箱或用户名' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254, { message: '登录账号过长' })
  account: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100, { message: '密码最多 100 个字符' })
  password: string;
}

export class AdminChallengeVerifyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class AdminLoginVerifyDto extends AdminChallengeVerifyDto {
  @ApiPropertyOptional({ default: false, description: '记住此设备七天，省略时沿用短会话' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  rememberDevice?: boolean;
}
