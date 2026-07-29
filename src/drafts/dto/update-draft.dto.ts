import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeContent } from '../../common/transform/sanitize.transform';

/** 更新草稿 DTO */
export class UpdateDraftDto {
  @ApiProperty({ example: '更新后的草稿内容...', description: '更新后的草稿内容', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => sanitizeContent(value))
  @MaxLength(10000)
  content: string;
}
