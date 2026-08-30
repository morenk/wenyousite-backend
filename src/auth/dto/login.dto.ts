import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** 登录请求 DTO：账号（邮箱或用户名）+ 密码 */
export class LoginDto {
  @ApiProperty({ example: 'user@example.com 或 zhangsan', description: '登录账号：邮箱或用户名' })
  @IsString()
  @IsNotEmpty({ message: '请输入邮箱或用户名' })
  @MaxLength(254, { message: '登录账号过长' })
  account: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8, description: '登录密码' })
  @IsString()
  @MinLength(8)
  @MaxLength(100, { message: '密码最多 100 个字符' })
  password: string;
}
