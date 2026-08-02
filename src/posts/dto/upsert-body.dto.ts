import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MinLength, MaxLength, Min } from 'class-validator';

/** 写入子贴正文 DTO（upsert：无正文创建，有正文乐观锁更新） */
export class UpsertBodyDto {
  @ApiProperty({ example: '这里是子贴正文…', description: '正文（Markdown）', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, description: '乐观锁版本号。正文已存在时必填（传入过期版本返回 409）；首次创建时忽略' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
