import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

/** 创建收藏 DTO */
export class CreateBookmarkDto {
  @ApiProperty({ description: '主题帖 ID' })
  @IsString()
  @IsUUID()
  threadId: string;
}
