import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

/** 批量重排子贴 DTO */
export class ReorderSubthreadsDto {
  @ApiProperty({ description: '按目标顺序排列的子贴 ID 列表，第一项将成为 sortOrder=0（即默认子贴）' })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
