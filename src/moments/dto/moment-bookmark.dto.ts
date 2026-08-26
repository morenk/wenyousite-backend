import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { MomentCardResponseDto } from './moment-response.dto';

export class MomentBookmarkQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: '只返回指定收藏夹中的动态；不传时返回全部' })
  @IsOptional()
  @IsString()
  @IsCuid()
  folderId?: string;
}

export class CreateMomentBookmarkDto {
  @ApiPropertyOptional({ description: '目标收藏夹 ID；不传时首次收藏归入默认收藏夹' })
  @IsOptional()
  @IsString()
  @IsCuid()
  folderId?: string;
}

export class MoveMomentBookmarkDto {
  @ApiProperty({ description: '要移入的收藏夹 ID' })
  @IsString()
  @IsCuid()
  folderId!: string;
}

export class CreateMomentBookmarkFolderDto {
  @ApiProperty({ example: '稍后阅读', minLength: 1, maxLength: 24 })
  @IsString()
  @Length(1, 24)
  name!: string;
}

export class MomentBookmarkFolderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ minimum: 0 })
  momentBookmarkCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class OwnMomentBookmarkResponseDto extends MomentCardResponseDto {
  @ApiProperty({ description: '所属私有收藏夹 ID' })
  bookmarkFolderId!: string;
}

export class MomentBookmarkPlacementResponseDto {
  @ApiProperty()
  momentId!: string;

  @ApiProperty()
  folderId!: string;
}
