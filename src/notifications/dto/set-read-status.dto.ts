import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 设置通知阅读状态 DTO */
export class SetReadStatusDto {
  @ApiProperty({ description: '阅读状态（true=已读，false=未读）' })
  @IsBoolean()
  isRead: boolean;
}
