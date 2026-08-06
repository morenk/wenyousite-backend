import { ApiProperty } from '@nestjs/swagger';

export class ContinueReadingFromDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true })
  floorNumber!: number | null;

  @ApiProperty({ type: String, nullable: true })
  parentPostId!: string | null;
}

export class NewRepliesResponseDto {
  @ApiProperty()
  subthreadId!: string;

  @ApiProperty({ minimum: 0 })
  newReplies!: number;

  @ApiProperty({ minimum: 0 })
  totalPosts!: number;

  @ApiProperty({ type: String, nullable: true })
  lastReadPostId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastReadTime!: Date | null;

  @ApiProperty({ type: ContinueReadingFromDto, nullable: true })
  continueFrom!: ContinueReadingFromDto | null;
}

export class ThreadNewRepliesResponseDto {
  @ApiProperty({ type: [NewRepliesResponseDto] })
  items!: NewRepliesResponseDto[];
}
