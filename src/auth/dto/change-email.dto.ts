import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

/** 更换邮箱第一步：请求验证码（需当前密码二次认证） */
export class ChangeEmailRequestDto {
  @ApiProperty({ example: 'newemail@example.com', description: '新邮箱地址' })
  @IsEmail()
  @MaxLength(254, { message: '邮箱地址过长' })
  newEmail: string;

  @ApiProperty({ example: 'CurrentPass123', description: '当前密码（二次认证）' })
  @IsString()
  @MinLength(1)
  @MaxLength(100, { message: '密码最多 100 个字符' })
  oldPassword: string;
}

/** 更换邮箱第二步：验证码确认 */
export class ChangeEmailVerifyDto {
  @ApiProperty({ example: 'newemail@example.com', description: '新邮箱地址' })
  @IsEmail()
  @MaxLength(254, { message: '邮箱地址过长' })
  newEmail: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6, description: '6 位邮箱验证码' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}
