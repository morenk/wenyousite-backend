import { ApiProperty } from '@nestjs/swagger';

export class MentionCandidateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ nullable: true })
  avatar!: string | null;

  @ApiProperty({ enum: ['FOLLOWING', 'PLAYER'] })
  relation!: 'FOLLOWING' | 'PLAYER';
}

export class MentionCandidatesResponseDto {
  @ApiProperty({ type: [MentionCandidateDto] })
  users!: MentionCandidateDto[];

  @ApiProperty({ description: '当前用户是否允许使用 @全体玩家' })
  canMentionAllPlayers!: boolean;
}
