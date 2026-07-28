import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsUUID } from 'class-validator';

/** 创建帖子 DTO */
export class CreatePostDto {
  @ApiProperty({ description: '帖子正文', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ description: '父帖 ID（楼中楼回复时指定，平级挂载，无嵌套深度限制）' })
  @IsOptional()
  @IsString()
  @IsUUID()
  parentPostId?: string;

  @ApiPropertyOptional({ description: '回复目标帖 ID（追踪具体回复哪个帖子）' })
  @IsOptional()
  @IsString()
  @IsUUID()
  replyToPostId?: string;
}
