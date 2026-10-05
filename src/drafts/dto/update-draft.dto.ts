import { MarkdownCapabilityDto } from '../../common/dto/markdown-capability.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, IsInt, Min } from 'class-validator';

/** 更新草稿 DTO */
export class UpdateDraftDto extends MarkdownCapabilityDto {
  @ApiProperty({
    example: '更新后的草稿内容...',
    description: '更新后的草稿正文',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiProperty({ example: 2, minimum: 1, description: '当前乐观锁版本' })
  @IsInt()
  @Min(1)
  version: number;
}
