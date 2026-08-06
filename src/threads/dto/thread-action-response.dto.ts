import { ApiProperty } from '@nestjs/swagger';
import { ThreadMemberResponseDto } from './thread-member-response.dto';

/** 点赞或取消点赞后返回的权威计数。 */
export class ThreadLikeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ minimum: 0 })
  likeCount!: number;
}

class JoinedThreadReferenceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;
}

/** 通过邀请加入后返回的成员记录及导航所需摘要。 */
export class JoinedThreadMemberResponseDto extends ThreadMemberResponseDto {
  @ApiProperty({ type: JoinedThreadReferenceResponseDto })
  thread!: JoinedThreadReferenceResponseDto;
}
