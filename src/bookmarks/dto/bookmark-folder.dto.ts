import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

export class BookmarkQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: '只返回指定收藏夹中的主题帖；不传时返回全部' })
  @IsOptional()
  @IsString()
  @IsCuid()
  folderId?: string;
}

export class CreateBookmarkFolderDto {
  @ApiProperty({ example: '跑团资料', minLength: 1, maxLength: 24 })
  @IsString()
  @Length(1, 24)
  name!: string;
}

export class MoveBookmarkDto {
  @ApiProperty({ description: '要移入的收藏夹 ID' })
  @IsString()
  @IsCuid()
  folderId!: string;
}

export class BookmarkFolderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ minimum: 0, description: '当前用户在该收藏夹中可见的主题帖收藏总数，与列表使用相同可见性规则，不受分页影响' })
  bookmarkCount!: number;

  @ApiProperty({
    minimum: 0,
    deprecated: true,
    description: '旧客户端兼容字段：当前用户在同名动态收藏夹中可见的动态收藏总数，与动态列表使用相同可见性规则，不受分页影响',
  })
  momentBookmarkCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class RenameBookmarkFolderDto {
  @ApiProperty({
    description: 'trim 后为 1–24 个字符；仅可重命名自定义收藏夹',
    example: '稍后阅读',
    minLength: 1,
    maxLength: 24,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 24)
  name!: string;
}
