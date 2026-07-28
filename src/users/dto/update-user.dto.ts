import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeContent } from '../../common/transform/sanitize.transform';

/** 更新用户资料 DTO：所有字段可选，仅传入需要修改的字段 */
export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 24, description: '用户名（字母、数字、中文）' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  @Matches(/^[a-zA-Z0-9\u4e00-\u9fff]+$/, { message: '用户名只能包含字母、数字和中文' })
  @Transform(sanitizeContent)
  username?: string;

  @ApiPropertyOptional({ maxLength: 255, description: '个人简介' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(sanitizeContent)
  bio?: string;

  @ApiPropertyOptional({ description: '隐私：允许他人查看最近回复' })
  @IsOptional()
  @IsBoolean()
  showRecentReplies?: boolean;

  @ApiPropertyOptional({ description: '隐私：允许显示玩家标记' })
  @IsOptional()
  @IsBoolean()
  showPlayerBadges?: boolean;

  @ApiPropertyOptional({ description: '隐私：允许显示收藏/订阅' })
  @IsOptional()
  @IsBoolean()
  showBookmarks?: boolean;
}
