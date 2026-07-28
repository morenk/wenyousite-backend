import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** 注册第一步：请求邮箱验证码 */
export class RequestCodeDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsEmail()
  email: string;
}
