import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

/** 重置密码 DTO */
export class ResetPasswordDto {
  @ApiProperty({ description: '注册邮箱（用于锚定用户身份）' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: '密码重置验证码' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ description: '新密码（至少 8 位，需包含字母和数字）', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)/, {
    message: '密码必须包含至少一个字母和一个数字',
  })
  newPassword: string;
}
