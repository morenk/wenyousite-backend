import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

/** 为子贴添加标签 DTO */
export class AddSubthreadTagDto {
  @ApiProperty({ description: '标签名', minLength: 1, maxLength: 20 })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  name: string;

  @ApiPropertyOptional({ description: '标签颜色（#RRGGBB 格式）' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: '颜色格式必须为 #RRGGBB' })
  color?: string;
}
