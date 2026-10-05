import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, IsOptional, MaxLength, IsUUID } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 创建帖子 DTO */
export class CreatePostDto {
  @ApiPropertyOptional({
    description:
      '本次新发言选择的帖内身份 ID；新客户端 RP 模式必须与该身份 token 一起发送。省略仅兼容旧单身份客户端；ACCOUNT 忽略，编辑旧正文不改变原身份',
  })
  @IsOptional()
  @IsString()
  @IsCuid()
  identityId?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'GET 帖内身份返回的确认 token；新建正文或发言时使用。身份变化返回 409/40011，保留草稿并重新确认',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  identityToken?: string;

  @ApiPropertyOptional({
    enum: ['ACCOUNT', 'RP'],
    description:
      '本次新发言身份；ACCOUNT 明确使用站内账号且不校验 RP token，RP 要求有效帖内身份和 identityToken。省略沿用旧确认规则；编辑已有正文忽略此字段',
  })
  @IsOptional()
  @IsIn(['ACCOUNT', 'RP'])
  identityMode?: 'ACCOUNT' | 'RP';

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
