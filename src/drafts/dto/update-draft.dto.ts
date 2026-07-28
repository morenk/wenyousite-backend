import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/** 更新草稿 DTO */
export class UpdateDraftDto {
  @ApiProperty({ description: '草稿内容', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;
}
