import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** 游标分页 DTO：cursor 是客户端只负责原样回传的不透明字符串。 */
export class CursorPaginationDto {
  @ApiPropertyOptional({ example: 'clxabc123...', description: '服务端返回的不透明分页游标；首次请求不传，后续必须原样回传' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 20, default: 20, description: '每页条数（默认 20，最大 50）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
