import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 创建订阅 DTO */
export class CreateSubscriptionDto {
  @ApiProperty({ example: 'clxthread001...', description: '要订阅的主题帖 ID' })
  @IsString()
  @IsCuid()
  threadId: string;

  @ApiProperty({ example: 'THREAD', enum: ['THREAD', 'USER'], description: 'THREAD=订阅整帖所有动态, USER=仅订阅帖内某用户的发言' })
  @IsString()
  @IsIn(['THREAD', 'USER'])
  type: 'THREAD' | 'USER';

  @ApiPropertyOptional({ example: 'clxuser001...', description: '目标用户 ID（type=USER 时必填，订阅该用户在帖内的发言）' })
  @IsOptional()
  @IsString()
  @IsCuid()
  targetUserId?: string;
}
