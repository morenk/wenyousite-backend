import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 创建收藏 DTO */
export class CreateBookmarkDto {
  @ApiProperty({ example: 'clxthread001...', description: '要收藏的主题帖 ID' })
  @IsString()
  @IsCuid()
  threadId: string;
}
