import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HomeThreadListItemResponseDto } from '../../threads/dto/thread-list-response.dto';

export class SearchUserResponseDto {
  @ApiProperty({ description: '用户 ID' })
  id: string;

  @ApiProperty({ description: '用户名' })
  username: string;

  @ApiProperty({ type: String, nullable: true, description: '头像 URL' })
  avatar: string | null;

  @ApiProperty({ type: String, nullable: true, description: '个人简介' })
  bio: string | null;
}

class SearchAuthorResponseDto {
  @ApiProperty({ description: '用户 ID' })
  id: string;

  @ApiProperty({ description: '用户名' })
  username: string;
}

export class SearchThreadResponseDto extends HomeThreadListItemResponseDto {
  @ApiPropertyOptional({
    type: Number,
    description: '仅说明本次查询的标题相关度；客户端不得作为稳定业务字段依赖',
  })
  relevance?: number;
}

class SearchThreadReferenceResponseDto {
  @ApiProperty({ description: '主题帖 ID' })
  id: string;

  @ApiProperty({ description: '主题帖标题' })
  title: string;
}

class SearchSubthreadReferenceResponseDto {
  @ApiProperty({ description: '子贴 ID' })
  id: string;

  @ApiProperty({ description: '子贴标题' })
  title: string;
}

export class SearchPostResponseDto {
  @ApiProperty({ description: '帖子 ID' })
  id: string;

  @ApiProperty({ type: Number, nullable: true, description: '楼层号；楼中楼为 null' })
  floorNumber: number | null;

  @ApiProperty({ type: String, nullable: true, description: '父楼层 ID；主楼层为 null' })
  parentPostId: string | null;

  @ApiProperty({ description: 'Markdown 正文' })
  content: string;

  @ApiProperty({ format: 'date-time', description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ type: SearchAuthorResponseDto, description: '作者信息' })
  author: SearchAuthorResponseDto;

  @ApiProperty({ type: SearchThreadReferenceResponseDto, description: '所属主题帖' })
  thread: SearchThreadReferenceResponseDto;

  @ApiProperty({ type: SearchSubthreadReferenceResponseDto, description: '所属子贴' })
  subthread: SearchSubthreadReferenceResponseDto;
}

export class SearchResultResponseDto {
  @ApiProperty({ type: [SearchUserResponseDto], description: '用户名匹配结果，最多 20 条' })
  users: SearchUserResponseDto[];

  @ApiProperty({
    type: [SearchThreadResponseDto],
    description: '公开主题帖标题匹配结果，最多 50 条',
  })
  threads: SearchThreadResponseDto[];

  @ApiProperty({
    type: [SearchPostResponseDto],
    description: '公开楼层正文兼容匹配结果，最多 20 条',
  })
  posts: SearchPostResponseDto[];
}
