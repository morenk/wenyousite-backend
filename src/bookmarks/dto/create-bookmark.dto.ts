import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

/** 创建收藏 DTO */
export class CreateBookmarkDto {
  @ApiProperty({ example: 'clxthread001...', description: '要收藏的主题帖 ID' })
  @IsString()
  @IsUUID()
  threadId: string;
}
