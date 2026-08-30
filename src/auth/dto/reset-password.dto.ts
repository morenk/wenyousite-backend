import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

/** 重置密码 DTO */
export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com', description: '需要重置密码的邮箱' })
  @IsEmail()
  @MaxLength(254, { message: '邮箱地址过长' })
  email: string;

  @ApiProperty({ example: '8a7b3c', minLength: 6, maxLength: 6, description: '6 位密码重置验证码' })
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  token: string;

  @ApiProperty({ example: 'NewPass123', description: '新密码（至少 8 位，需包含字母和数字）', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)/, {
    message: '密码必须包含至少一个字母和一个数字',
  })
  newPassword: string;
}
