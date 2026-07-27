import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Cursor for next page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  limit?: number = 20;
}
