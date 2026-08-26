import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, IsUUID } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 创建帖子 DTO */
export class CreatePostDto {
  @ApiProperty({
    example: '这是一段正文内容，支持 Markdown 格式。',
    description: '帖子正文；骰子使用 [[dice:v1:<UUID>:<NdM±K>]] 内联节点',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({
    example: 'clxfloor001...',
    description: '父楼层 ID（楼中楼回复时指定，平级挂载，无嵌套深度限制）',
  })
  @IsOptional()
  @IsString()
  @IsCuid()
  parentPostId?: string;

  @ApiPropertyOptional({
    example: 'clxreply001...',
    description: '回复目标帖 ID；必须同时提供 parentPostId，且目标属于该主楼层',
  })
  @IsOptional()
  @IsString()
  @IsCuid()
  replyToPostId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '客户端创建请求幂等键；同一次用户提交及网络重试必须复用',
  })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}
