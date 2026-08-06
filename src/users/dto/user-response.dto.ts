import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';

class UserSocialCountResponseDto {
  @ApiProperty({ minimum: 0 })
  following!: number;

  @ApiProperty({ minimum: 0 })
  followers!: number;
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

  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;

  @ApiProperty({ enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] })
  role!: 'USER' | 'ADMIN' | 'SUPER_ADMIN';

  @ApiProperty()
  showRecentReplies!: boolean;

  @ApiProperty()
  showPlayerBadges!: boolean;

  @ApiProperty()
  showBookmarks!: boolean;

  @ApiProperty()
  emailVerified!: boolean;

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

  @ApiPropertyOptional({ type: String, nullable: true })
  bio?: string | null;

  @ApiPropertyOptional({ enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] })
  role?: 'USER' | 'ADMIN' | 'SUPER_ADMIN';

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
