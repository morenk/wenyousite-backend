import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsUUID } from 'class-validator';

/** 创建订阅 DTO */
export class CreateSubscriptionDto {
  @ApiProperty({ description: '主题帖 ID' })
  @IsString()
  @IsUUID()
  threadId: string;

  @ApiProperty({ enum: ['THREAD', 'USER'], description: '订阅类型：THREAD 整帖 / USER 某用户' })
  @IsString()
  @IsIn(['THREAD', 'USER'])
  type: 'THREAD' | 'USER';

  @ApiPropertyOptional({ description: '目标用户 ID（type=USER 时必填）' })
  @IsOptional()
  @IsString()
  @IsUUID()
  targetUserId?: string;
}
