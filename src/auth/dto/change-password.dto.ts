import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

/** 修改密码 DTO */
export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  oldPassword: string;

  @ApiProperty({ description: '新密码（至少 8 位，需包含字母和数字）', minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)/, {
    message: '密码必须包含至少一个字母和一个数字',
  })
  newPassword: string;
}
