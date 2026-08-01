import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

/** 注册第二步：验证邮箱 + 设置用户名密码，一步完成注册 */
export class VerifyAndCompleteDto {
  @ApiProperty({ example: 'user@example.com', description: '注册邮箱（需与上一步一致）' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '209794', minLength: 6, maxLength: 6, description: '6 位数字验证码' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;

  @ApiProperty({ example: 'zhangsan', minLength: 2, maxLength: 24, description: '用户名（字母、数字、中文）' })
  @IsString()
  @MinLength(2, { message: '用户名至少 2 个字符' })
  @MaxLength(24, { message: '用户名最多 24 个字符' })
  @Matches(/^[a-zA-Z0-9\u4e00-\u9fff]+$/, {
    message: '用户名只能包含字母、数字和中文',
  })
  username: string;

  @ApiProperty({ example: 'SecurePass123', minLength: 8, maxLength: 100, description: '登录密码（至少 8 位，需包含字母和数字）' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)/, {
    message: '密码必须包含至少一个字母和一个数字',
  })
  password: string;
}
