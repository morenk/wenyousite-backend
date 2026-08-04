import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 创建订阅 DTO */
export class CreateSubscriptionDto {
  @ApiProperty({ example: 'clxthread001...', description: '要订阅的主题帖 ID' })
  @IsString()
  @IsCuid()
  threadId: string;

  @ApiProperty({ example: 'THREAD', enum: ['THREAD', 'USER'], description: 'THREAD=楼主或协作者发布的官方更新, USER=指定普通玩家在帖内的新发言' })
  @IsString()
  @IsIn(['THREAD', 'USER'])
  type: 'THREAD' | 'USER';

  @ApiPropertyOptional({ example: 'clxuser001...', description: '目标玩家 ID（type=USER 时必填；必须是本帖已标记玩家的普通参与人）' })
  @IsOptional()
  @IsString()
  @IsCuid()
  targetUserId?: string;
}
