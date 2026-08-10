import { ApiProperty } from '@nestjs/swagger';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdminInviteDto {
  @ApiProperty({ description: '已验证邮箱的现有温油账号 ID' })
  @IsCuid()
  userId!: string;
}

export class AdminAccountReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class TransferSuperAdminDto extends AdminAccountReasonDto {
  @ApiProperty({ description: '接任超级管理员的现有管理员 ID' })
  @IsCuid()
  userId!: string;
}
