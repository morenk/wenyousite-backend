import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SubthreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  posts!: number;
}

class SubthreadThreadReferenceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility!: 'PUBLIC' | 'PRIVATE';
}

export class SubthreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ enum: ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'] })
  postingPolicy!: 'PARTICIPANTS' | 'COLLABORATORS' | 'PLAYERS';

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastPostAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: SubthreadCountResponseDto })
  _count!: SubthreadCountResponseDto;

  @ApiPropertyOptional({ type: SubthreadThreadReferenceResponseDto })
  thread?: SubthreadThreadReferenceResponseDto;
}
