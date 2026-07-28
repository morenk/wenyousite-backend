import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeContent } from '../../common/transform/sanitize.transform';

/** 编辑帖子 DTO */
export class UpdatePostDto {
  @ApiProperty({ example: '编辑后的内容...', description: '新正文', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => sanitizeContent(value))
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ description: '乐观锁版本号' })
  @IsOptional()
  @IsNumber()
  version?: number;
}
