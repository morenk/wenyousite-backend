import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** 主题帖本地档案导出选项。 */
export class ThreadExportDto {
  @ApiPropertyOptional({ type: Boolean, default: true, description: '是否保留作者名' })
  @IsOptional()
  @IsBoolean()
  includeAuthors = true;

  @ApiPropertyOptional({ type: Boolean, default: true, description: '是否保留时间戳' })
  @IsOptional()
  @IsBoolean()
  includeTimestamps = true;

  @ApiPropertyOptional({ type: Boolean, default: true, description: '是否保留楼层号' })
  @IsOptional()
  @IsBoolean()
  includeFloorNumbers = true;

  @ApiPropertyOptional({ type: Boolean, default: true, description: '是否保留回复目标' })
  @IsOptional()
  @IsBoolean()
  includeReplyTargets = true;

  @ApiPropertyOptional({ type: Boolean, default: false, description: '是否保留站内来源链接；邀请链接始终脱敏' })
  @IsOptional()
  @IsBoolean()
  includeSourceLinks = false;

  @ApiPropertyOptional({ type: Boolean, default: true, description: '是否将站内媒体打包到 ZIP' })
  @IsOptional()
  @IsBoolean()
  includeMedia = true;
}
