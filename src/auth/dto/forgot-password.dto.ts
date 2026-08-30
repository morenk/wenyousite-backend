import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/** 忘记密码 DTO */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com', description: '需要重置密码的邮箱' })
  @IsEmail()
  @MaxLength(254, { message: '邮箱地址过长' })
  email: string;
}
