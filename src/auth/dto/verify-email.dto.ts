import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** 邮箱验证 DTO */
export class VerifyEmailDto {
  @ApiProperty({ example: '8a7b3c', minLength: 6, maxLength: 6, description: '6 位邮箱验证码' })
  @IsString()
  @MinLength(1)
  token: string;
}
