import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeContent } from '../../common/transform/sanitize.transform';

/** 创建帖子 DTO */
export class CreatePostDto {
  @ApiProperty({ example: '这是一段正文内容，支持 Markdown 格式。', description: '帖子正文（支持 Markdown，前后端不渲染）', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => sanitizeContent(value))
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ example: 'clxfloor001...', description: '父楼层 ID（楼中楼回复时指定，平级挂载，无嵌套深度限制）' })
  @IsOptional()
  @IsString()
  @IsUUID()
  parentPostId?: string;

  @ApiPropertyOptional({ example: 'clxreply001...', description: '回复目标帖 ID（追踪具体回复哪个帖子，可为同楼层其他回复）' })
  @IsOptional()
  @IsString()
  @IsUUID()
  replyToPostId?: string;
}
