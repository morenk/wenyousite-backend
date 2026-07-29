import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

/** 批量重排子贴 DTO */
export class ReorderSubthreadsDto {
  @ApiProperty({ example: ['subthread-id-1', 'subthread-id-2', 'subthread-id-3'], description: '按目标顺序排列的子贴 ID 列表，第一项将成为 sortOrder=0（默认子贴，不可变）' })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
