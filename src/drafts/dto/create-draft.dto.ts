import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsIn, IsInt, Min } from 'class-validator';

/** 保存草稿 DTO */
export class CreateDraftDto {
  @ApiProperty({ example: '这是一段草稿内容...', description: '草稿正文（Markdown 格式，与楼层一致）', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ example: 1, description: '草稿位（1-5），不传则自动选择空闲位' })
  @IsOptional()
  @IsIn([1, 2, 3, 4, 5])
  slot?: number;

  @ApiPropertyOptional({ example: 2, minimum: 1, description: '覆盖已有槽位时必填的当前乐观锁版本；创建空槽位时省略' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
