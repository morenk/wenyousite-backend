import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum } from 'class-validator';

export const DIRECT_REQUEST_ACTIONS = ['ACCEPT', 'DECLINE'] as const;
export type DirectRequestAction = (typeof DIRECT_REQUEST_ACTIONS)[number];

export class HandleDirectRequestDto {
  @ApiProperty({ enum: DIRECT_REQUEST_ACTIONS })
  @IsEnum(DIRECT_REQUEST_ACTIONS)
  action!: DirectRequestAction;
}

export class SetDirectConversationArchiveDto {
  @ApiProperty({ description: 'true 归档；false 恢复到主列表' })
  @IsBoolean()
  archived!: boolean;
}
