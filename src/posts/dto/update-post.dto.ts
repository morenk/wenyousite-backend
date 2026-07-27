import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/** 编辑帖子 DTO */
export class UpdatePostDto {
  @ApiProperty({ example: '编辑后的内容...', description: '新正文', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;
}
