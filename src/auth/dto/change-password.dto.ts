import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/** 修改密码 DTO */
export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  oldPassword: string;

  @ApiProperty({ description: '新密码', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}
