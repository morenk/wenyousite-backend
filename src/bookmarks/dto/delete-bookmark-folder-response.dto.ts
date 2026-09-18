import { ApiProperty } from '@nestjs/swagger';

export class DeleteBookmarkFolderResponseDto {
  @ApiProperty({ description: '已删除的自定义收藏夹 ID' })
  deletedFolderId!: string;

  @ApiProperty({ description: '接收全部收藏的同类型默认收藏夹 ID' })
  destinationFolderId!: string;
}
