import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MaxLength, Min } from 'class-validator';

/** 写入子贴正文 DTO（upsert：无正文创建，有正文乐观锁更新） */
export class UpsertBodyDto {
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
