import { RpIdentityResponseDto } from '../../thread-identities/thread-identity.dto';
import { MediaDisplayResponseDto } from '../../media/dto/media-display.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MentionCandidateDto {
  @ApiPropertyOptional({ type: RpIdentityResponseDto, nullable: true, description: '仅帖内上下文返回；账号字段不变，展示优先使用此身份' })
  rpIdentity?: RpIdentityResponseDto | null;
  @ApiPropertyOptional({ type: MediaDisplayResponseDto, nullable: true, description: '头像完整 WebP 展示资源；avatar 保留来源身份' })
  avatarDisplay?: MediaDisplayResponseDto | null;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ enum: ['FOLLOWING', 'PLAYER', 'OWNER', 'COLLABORATOR'] })
  relation!: 'FOLLOWING' | 'PLAYER' | 'OWNER' | 'COLLABORATOR';
}

export class MentionCandidatesResponseDto {
  @ApiProperty({ type: [MentionCandidateDto] })
  users!: MentionCandidateDto[];

  @ApiProperty({ description: '当前用户是否允许使用 @全体玩家' })
  canMentionAllPlayers!: boolean;
}
