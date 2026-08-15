import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';

class UserSocialCountResponseDto {
  @ApiProperty({ minimum: 0 })
  following!: number;

  @ApiProperty({ minimum: 0 })
  followers!: number;
}

export class ProfileCoverVariantResponseDto {
  @ApiProperty({ description: '背景图原图地址' })
  url!: string;

  @ApiProperty({ type: String, nullable: true, description: '800px WebP 中图地址' })
  mediumUrl!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;
}

export class ProfileCoverResponseDto extends ProfileCoverVariantResponseDto {
  @ApiProperty({
    type: ProfileCoverVariantResponseDto,
    nullable: true,
    description: '移动端 2:1 裁切；历史背景图可能为空',
  })
  mobile!: ProfileCoverVariantResponseDto | null;
}

export class PrivateUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ type: ProfileCoverResponseDto, nullable: true })
  profileCover!: ProfileCoverResponseDto | null;

  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;

  @ApiProperty({ enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] })
  role!: 'USER' | 'ADMIN' | 'SUPER_ADMIN';

  @ApiProperty({ minimum: 1, maximum: 9 })
  level!: number;

  @ApiProperty({ minimum: 0 })
  experience!: number;

  @ApiProperty({ minimum: 0 })
  currentLevelExperience!: number;

  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  nextLevelExperience!: number | null;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  receivedTipTotal!: string;

  @ApiProperty({ minimum: 0 })
  receivedTipCount!: number;

  @ApiProperty()
  showRecentReplies!: boolean;

  @ApiProperty()
  showPlayerBadges!: boolean;

  @ApiProperty()
  showBookmarks!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class CurrentUserResponseDto extends PrivateUserResponseDto {
  @ApiProperty({ type: UserSocialCountResponseDto })
  _count!: UserSocialCountResponseDto;
}

/** 注销用户只保留 id/username/isDeactivated，因此其余公开资料字段均为可选。 */
export class PublicUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  avatar?: string | null;

  @ApiPropertyOptional({ type: ProfileCoverResponseDto, nullable: true })
  profileCover?: ProfileCoverResponseDto | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bio?: string | null;

  @ApiPropertyOptional({ enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] })
  role?: 'USER' | 'ADMIN' | 'SUPER_ADMIN';

  @ApiPropertyOptional({ minimum: 1, maximum: 9 })
  level?: number;

  @ApiPropertyOptional({ type: String, pattern: '^\\d+$' })
  receivedTipTotal?: string;

  @ApiPropertyOptional({ minimum: 0 })
  receivedTipCount?: number;

  @ApiPropertyOptional()
  showRecentReplies?: boolean;

  @ApiPropertyOptional()
  showPlayerBadges?: boolean;

  @ApiPropertyOptional()
  showBookmarks?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  createdAt?: Date;

  @ApiPropertyOptional({ type: UserSocialCountResponseDto })
  _count?: UserSocialCountResponseDto;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'SUSPENDED', 'BANNED'],
    description: '公开账号状态；只区分有效的临时或永久封禁，不包含处罚截止时间',
  })
  accountStatus?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';

  @ApiPropertyOptional()
  isFollowing?: boolean;

  @ApiPropertyOptional()
  isFollowedBy?: boolean;

  @ApiPropertyOptional()
  isBlocked?: boolean;

  @ApiPropertyOptional()
  isBlockedBy?: boolean;

  @ApiPropertyOptional()
  isDeactivated?: boolean;
}

export class UserActivitySummaryResponseDto {
  @ApiProperty({ minimum: 0, description: '当前查看者可见的未删除动态数' })
  momentCount!: number;

  @ApiProperty({ minimum: 0, description: '当前查看者可见的已发布自建主题数' })
  createdThreadCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: '当前查看者可见的玩家身份参与主题数；未公开时为 null',
  })
  playedThreadCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: '当前查看者可见的存活楼层/楼中楼回复数；未公开时为 null',
  })
  replyCount!: number | null;
}

class RecentReplyThreadResponseDto {
  @ApiProperty()
  title!: string;
}

class RecentReplySubthreadResponseDto {
  @ApiProperty()
  title!: string;
}

class RecentReplyDiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  nodeId!: string;

  @ApiProperty()
  notation!: string;

  @ApiProperty()
  total!: number;
}

export class RecentReplyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: Number, nullable: true })
  floorNumber!: number | null;

  @ApiProperty({ type: String, nullable: true })
  parentPostId!: string | null;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty({ type: RecentReplyThreadResponseDto })
  thread!: RecentReplyThreadResponseDto;

  @ApiProperty()
  subthreadId!: string;

  @ApiProperty({ type: RecentReplySubthreadResponseDto })
  subthread!: RecentReplySubthreadResponseDto;

  @ApiProperty({ type: [RecentReplyDiceResponseDto] })
  diceRolls!: RecentReplyDiceResponseDto[];

  @ApiProperty()
  preview!: string;
}

export class UserFollowRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  followerId!: string;

  @ApiProperty()
  followingId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ type: PostAuthorResponseDto })
  following?: PostAuthorResponseDto;

  @ApiPropertyOptional({ type: PostAuthorResponseDto })
  follower?: PostAuthorResponseDto;
}

export class BlockedUserRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  blockerId!: string;

  @ApiProperty()
  blockedId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: PostAuthorResponseDto })
  blocked!: PostAuthorResponseDto;
}
