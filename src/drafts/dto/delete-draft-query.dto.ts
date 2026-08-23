import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** 删除草稿查询条件；兼容期允许旧客户端省略 version。 */
export class DeleteDraftQueryDto {
  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: '要删除的当前乐观锁版本；提供后不会删除其他设备更新出的新版本',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
