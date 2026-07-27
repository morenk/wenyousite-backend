import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

/** 创建楼层/楼中楼 DTO */
export class CreatePostDto {
  @ApiProperty({ example: '这是新楼层的内容...', description: '帖子正文（Markdown 富文本）', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ description: '楼中楼：父楼层 ID（不传则创建为楼层）' })
  @IsOptional()
  @IsString()
  parentPostId?: string;

  @ApiPropertyOptional({ description: '回复对象：被回复的帖子 ID' })
  @IsOptional()
  @IsString()
  replyToPostId?: string;
}
