import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

/** 登录请求 DTO：邮箱 + 密码 */
export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: '注册邮箱' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!', description: '登录密码' })
  @IsString()
  password: string;
}
