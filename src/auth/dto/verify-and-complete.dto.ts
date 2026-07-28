import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

/** 注册第二步：验证邮箱 + 设置用户名密码，一步完成注册 */
export class VerifyAndCompleteDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: '6 位验证码' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;

  @ApiProperty({ example: 'zhangsan', minLength: 2, maxLength: 24, description: '用户名（字母、数字、下划线、中文）' })
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  @Matches(/^[a-zA-Z0-9_\u4e00-\u9fff]+$/, {
    message: '用户名只能包含字母、数字、下划线和中文',
  })
  username: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8, maxLength: 100, description: '登录密码（至少 8 位）' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;
}
