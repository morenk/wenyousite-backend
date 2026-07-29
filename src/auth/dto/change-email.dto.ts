import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

/** 更换邮箱第一步：请求验证码 */
export class ChangeEmailRequestDto {
  @ApiProperty({ example: 'newemail@example.com', description: '新邮箱地址' })
  @IsEmail()
  newEmail: string;
}

/** 更换邮箱第二步：验证码确认 */
export class ChangeEmailVerifyDto {
  @ApiProperty({ example: 'newemail@example.com', description: '新邮箱地址' })
  @IsEmail()
  newEmail: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6, description: '6 位邮箱验证码' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}
