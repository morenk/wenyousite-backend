import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** 重发验证邮件 DTO */
export class ResendVerificationDto {
  @ApiProperty({ example: 'user@example.com', description: '需要重发验证邮件的邮箱' })
  @IsEmail()
  email: string;
}
