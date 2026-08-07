import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export const DIRECT_CONVERSATION_VIEWS = ['INBOX', 'REQUESTS', 'ARCHIVED'] as const;
export type DirectConversationView = (typeof DIRECT_CONVERSATION_VIEWS)[number];

export class DirectConversationQueryDto {
  @ApiPropertyOptional({ enum: DIRECT_CONVERSATION_VIEWS, default: 'INBOX' })
  @IsOptional()
  @IsEnum(DIRECT_CONVERSATION_VIEWS)
  view: DirectConversationView = 'INBOX';

  @ApiPropertyOptional({ description: '上一页最后一条会话 ID' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class DirectMessageQueryDto {
  @ApiPropertyOptional({ description: '加载此消息之前的历史消息；不能与 after 同时使用' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: '增量加载此消息之后的新消息；不能与 cursor 同时使用' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit: number = 30;
}
