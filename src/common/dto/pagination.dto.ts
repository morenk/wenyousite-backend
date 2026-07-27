import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 游标分页 DTO：使用 cursor 替代传统 offset，避免大偏移量性能问题 */
export class CursorPaginationDto {
  @ApiPropertyOptional({ description: '分页游标，上一页最后一条记录的 ID' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  limit?: number = 20;
}
