import { ApiProperty } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  color!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
