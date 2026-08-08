import { ApiProperty } from '@nestjs/swagger';

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

class SearchThreadOwnerResponseDto extends SearchAuthorResponseDto {
  @ApiProperty({ type: String, nullable: true, description: '头像 URL' })
  avatar: string | null;
}

class SearchThreadCountResponseDto {
  @ApiProperty({ description: '参与人数' })
  members: number;

  @ApiProperty({ description: '帖子数' })
  posts: number;

  @ApiProperty({ description: '已标记玩家数' })
  players: number;
}

export class SearchThreadResponseDto {
  @ApiProperty({ description: '主题帖 ID' })
  id: string;

  @ApiProperty({ description: '主题帖标题' })
  title: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEDUCTION', description: '动态分类 slug' })
  category: string | null;

  @ApiProperty({ format: 'date-time', description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ type: SearchThreadOwnerResponseDto, description: '楼主信息' })
  owner: SearchThreadOwnerResponseDto;

  @ApiProperty({ type: SearchThreadCountResponseDto, description: '主题帖统计' })
  _count: SearchThreadCountResponseDto;

  @ApiProperty({
    type: [String],
    maxItems: 3,
    description: '默认主贴正文中的普通图片 URL，按出现顺序返回，最多 3 张',
  })
  coverImages: string[];
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
