import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** 邮箱验证 DTO */
export class VerifyEmailDto {
  @ApiProperty({ description: '邮箱验证 token' })
  @IsString()
  @MinLength(1)
  token: string;
}
