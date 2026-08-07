import { ApiProperty } from '@nestjs/swagger';

export class ReportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  reporterId!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ enum: ['PENDING', 'RESOLVED', 'DISMISSED'] })
  status!: string;

  @ApiProperty({ type: String, nullable: true })
  handledBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  handledAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
