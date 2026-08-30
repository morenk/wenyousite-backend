import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/** 注册第一步：请求邮箱验证码 */
export class RequestCodeDto {
  @ApiProperty({ example: 'user@example.com', description: '注册邮箱' })
  @IsEmail()
  @MaxLength(254, { message: '邮箱地址过长' })
  email: string;
}
