import { MarkdownCapabilityDto } from '../../common/dto/markdown-capability.dto';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, IsOptional, IsInt, MaxLength, Min } from 'class-validator';

/** 写入子贴正文 DTO（upsert：无正文创建，有正文乐观锁更新） */
export class UpsertBodyDto extends MarkdownCapabilityDto {
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
    example: '这里是子贴正文…',
    description: '正文（Markdown）；骰子使用内联节点，发布时仍必须包含非骰子可见文字',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: '乐观锁版本号。正文已存在时必填（传入过期版本返回 409）；首次创建时忽略',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
