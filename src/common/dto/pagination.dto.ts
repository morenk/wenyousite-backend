import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/** 游标分页 DTO：使用 cursor 替代传统 offset，避免大偏移量性能问题 */
export class CursorPaginationDto {
  @ApiPropertyOptional({ example: 'clxabc123...', description: '分页游标（上一页最后一条记录的 ID），首次请求不传' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 20, default: 20, description: '每页条数（默认 20，最大 50）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
