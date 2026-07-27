import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

/** 创建主题帖标签 DTO */
export class CreateTagDto {
  @ApiProperty({ example: '无限流', description: '标签名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_\u4e00-\u9fff#]+$/, {
    message: '标签名只能包含字母、数字、下划线、中文和 #',
  })
  name: string;

  @ApiPropertyOptional({ example: '#FF6B6B', description: '标签颜色（十六进制）' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: '颜色格式必须为 #RRGGBB' })
  color?: string;
}
