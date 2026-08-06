import { ApiProperty } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';

export class ThreadMemberResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: ['OWNER', 'COLLABORATOR', 'PARTICIPANT'] })
  role!: 'OWNER' | 'COLLABORATOR' | 'PARTICIPANT';

  @ApiProperty()
  playerMarked!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  joinedAt!: Date;

  @ApiProperty({ type: PostAuthorResponseDto })
  user!: PostAuthorResponseDto;
}
