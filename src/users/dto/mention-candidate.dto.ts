import { RpIdentityResponseDto } from '../../thread-identities/thread-identity.dto';
import { MediaDisplayResponseDto } from '../../media/dto/media-display.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MentionCandidateDto {
  @ApiPropertyOptional({ description: 'includeIdentities=true 时的稳定候选键；ACCOUNT:userId 或 RP:identityId，禁止按 userId 去重' })
  candidateKey?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: '选中的稳定角色 ID；账号候选为 null' })
  targetIdentityId?: string | null;
  @ApiPropertyOptional({ description: '插入时称呼；原样保存在源码，不用后续当前昵称替换' })
  mentionLabel?: string;
  @ApiPropertyOptional({ description: '规范 Markdown 链接目标；ACCOUNT 带 identityMode=ACCOUNT，角色带 rpIdentityId' })
  mentionHref?: string;

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
