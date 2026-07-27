import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 更新用户资料 DTO：所有字段可选，仅传入需要修改的字段 */
export class UpdateUserDto {
  @ApiPropertyOptional({ maxLength: 24, description: '新用户名' })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  username?: string;

  @ApiPropertyOptional({ maxLength: 50, description: '显示昵称' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @ApiPropertyOptional({ maxLength: 255, description: '个人简介' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bio?: string;

  @ApiPropertyOptional({ description: '头像 URL' })
  @IsOptional()
  @IsString()
  avatar?: string;
}
