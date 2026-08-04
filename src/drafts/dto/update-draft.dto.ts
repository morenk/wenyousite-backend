import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsInt, Min } from 'class-validator';

/** 更新草稿 DTO */
export class UpdateDraftDto {
  @ApiProperty({ example: '更新后的草稿内容...', description: '更新后的草稿内容', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiProperty({ example: 2, minimum: 1, description: '当前乐观锁版本' })
  @IsInt()
  @Min(1)
  version: number;
}
