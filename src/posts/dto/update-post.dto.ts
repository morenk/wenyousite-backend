import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MinLength, MaxLength, Min } from 'class-validator';
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

  @ApiProperty({ description: '乐观锁版本号（必填，前端需先 fetch 获取当前 version）' })
  @IsInt()
  @Min(1)
  version: number;
}
