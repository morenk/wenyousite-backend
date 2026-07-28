import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

/** 邀请成员加入主题帖 DTO */
export class InviteMemberDto {
  @ApiProperty({ description: '被邀请用户 ID' })
  @IsString()
  @IsUUID()
  userId: string;
}
