import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/** 重置密码 DTO */
export class ResetPasswordDto {
  @ApiProperty({ description: '密码重置 token' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ description: '新密码', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}
