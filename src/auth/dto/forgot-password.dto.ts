import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** 忘记密码 DTO */
export class ForgotPasswordDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsEmail()
  email: string;
}
