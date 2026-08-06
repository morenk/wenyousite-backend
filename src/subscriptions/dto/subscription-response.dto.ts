import { ApiProperty } from '@nestjs/swagger';

class SubscriptionThreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['DEDUCTION', 'NATION', 'RPG'] })
  category!: 'DEDUCTION' | 'NATION' | 'RPG';
}

export class SubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty({ type: String, nullable: true })
  targetUserId!: string | null;

  @ApiProperty({ enum: ['THREAD', 'USER'] })
  type!: 'THREAD' | 'USER';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: SubscriptionThreadResponseDto })
  thread!: SubscriptionThreadResponseDto;
}
