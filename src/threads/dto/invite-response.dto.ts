import { ApiProperty } from '@nestjs/swagger';

class InviteOwnerResponseDto {
  @ApiProperty({ description: '楼主用户 ID' })
  id: string;

  @ApiProperty({ description: '楼主用户名' })
  username: string;

  @ApiProperty({ type: String, nullable: true, description: '楼主头像 URL' })
  avatar: string | null;
}

class InviteThreadPreviewResponseDto {
  @ApiProperty({ description: '主题帖 ID' })
  id: string;

  @ApiProperty({ description: '主题帖标题' })
  title: string;

  @ApiProperty({ enum: ['DEDUCTION', 'NATION', 'RPG'], description: '主题帖分区' })
  category: 'DEDUCTION' | 'NATION' | 'RPG';

  @ApiProperty({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'], description: '主题帖状态' })
  status: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiProperty({ type: InviteOwnerResponseDto, description: '楼主信息' })
  owner: InviteOwnerResponseDto;

  @ApiProperty({ description: '当前参与人数' })
  memberCount: number;

  @ApiProperty({ format: 'date-time', description: '主题帖创建时间' })
  createdAt: Date;
}

export class InvitePreviewResponseDto {
  @ApiProperty({ type: InviteThreadPreviewResponseDto, description: '邀请对应的主题帖概要' })
  thread: InviteThreadPreviewResponseDto;

  @ApiProperty({ description: '当前登录用户是否已经加入该主题帖' })
  alreadyJoined: boolean;
}
