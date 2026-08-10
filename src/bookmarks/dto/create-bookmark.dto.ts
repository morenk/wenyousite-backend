import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 创建收藏 DTO */
export class CreateBookmarkDto {
  @ApiProperty({ example: 'clxthread001...', description: '要收藏的主题帖 ID' })
  @IsString()
  @IsCuid()
  threadId: string;

  @ApiPropertyOptional({ description: '目标收藏夹 ID；不传时归入默认收藏夹' })
  @IsOptional()
  @IsString()
  @IsCuid()
  folderId?: string;
}
