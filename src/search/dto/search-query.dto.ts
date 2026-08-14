import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchKeywordQueryDto {
  @ApiProperty({ description: '搜索关键词，首尾空白会被移除', maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q: string;
}

export class SearchThreadsQueryDto extends SearchKeywordQueryDto {
  @ApiPropertyOptional({ description: '上一页返回的不透明游标' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    type: Number,
    description: '每页条数；旧客户端省略时保持最多 50 条，新客户端建议显式传 20',
    default: 50,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 50;
}

export class SearchPostsQueryDto extends SearchKeywordQueryDto {
  @ApiPropertyOptional({ description: '上一页返回的不透明游标' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    type: Number,
    description: '每页条数，默认及最大均为 20',
    default: 20,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 20;
}
