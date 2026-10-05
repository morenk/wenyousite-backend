import { MarkdownCapabilityDto } from '../../common/dto/markdown-capability.dto';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsIn,
  IsNumber,
  IsUUID,
} from 'class-validator';
import { PostingPolicy } from '@prisma/client';

/** 创建子贴 DTO */
export class CreateSubthreadDto extends MarkdownCapabilityDto {
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

  @ApiPropertyOptional({
    format: 'uuid',
    description: '客户端创建幂等键；同一次提交和网络重试必须复用',
  })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;

  @ApiProperty({ example: '设定区', description: '子贴标题', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({
    example: '这里是世界观设定...',
    description: '子贴正文（kind=BODY，可选，留空仅创建空子贴）',
    maxLength: 10000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ example: 1, description: '排序序号，越小越靠前' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({
    example: 'PLAYERS',
    enum: PostingPolicy,
    default: 'PARTICIPANTS',
    description:
      'PARTICIPANTS=所有参与人可发帖, COLLABORATORS=仅协作者可发帖, PLAYERS=仅被标记为玩家的参与人可发帖',
  })
  @IsOptional()
  @IsString()
  @IsIn(['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'])
  postingPolicy?: PostingPolicy;
}
