import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** 重发验证邮件 DTO */
export class ResendVerificationDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsEmail()
  email: string;
}
