import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';

/** 更新阅读进度 DTO */
export class UpdateReadingProgressDto {
  @ApiProperty({ example: 'clxsubthread001...', description: '子贴 ID' })
  @IsString()
  @IsUUID()
  subthreadId: string;

  @ApiPropertyOptional({ example: 'clxpost001...', description: '帖子 ID（记录读到哪条帖子，精确到楼层/楼中楼）' })
  @IsOptional()
  @IsString()
  @IsUUID()
  postId?: string;
}
