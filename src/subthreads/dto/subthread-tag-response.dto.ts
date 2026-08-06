import { ApiProperty } from '@nestjs/swagger';

/** 主题帖内的子贴标签定义。 */
export class SubthreadTagDefinitionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  color!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** 子贴与标签定义的关联。 */
export class SubthreadTagRelationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  subthreadId!: string;

  @ApiProperty()
  tagId!: string;

  @ApiProperty({ type: SubthreadTagDefinitionResponseDto })
  tag!: SubthreadTagDefinitionResponseDto;
}
