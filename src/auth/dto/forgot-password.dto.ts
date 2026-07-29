import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** 忘记密码 DTO */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com', description: '需要重置密码的邮箱' })
  @IsEmail()
  email: string;
}
