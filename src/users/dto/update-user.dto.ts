import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeContent } from '../../common/transform/sanitize.transform';

/** 更新用户资料 DTO：所有字段可选，仅传入需要修改的字段 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: '新昵称', minLength: 2, maxLength: 24, description: '用户名（字母、数字、中文，修改后 7 天内不可再次修改）' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: '用户名至少 2 个字符' })
  @MaxLength(24, { message: '用户名最多 24 个字符' })
  @Matches(/^[a-zA-Z0-9\u4e00-\u9fff]+$/, { message: '用户名只能包含字母、数字和中文' })
  @Transform(({ value }) => sanitizeContent(value))
  username?: string;

  @ApiPropertyOptional({ example: '这个人很懒，什么都没有写...', minLength: 1, maxLength: 255, description: '个人简介' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '简介不能为空' })
  @MaxLength(255, { message: '简介最多 255 个字符' })
  @Transform(({ value }) => sanitizeContent(typeof value === 'string' ? value.trim() : value))
  bio?: string;

  @ApiPropertyOptional({ example: true, description: '隐私设置：允许他人在我的主页查看最近回复' })
  @IsOptional()
  @IsBoolean()
  showRecentReplies?: boolean;

  @ApiPropertyOptional({ example: true, description: '隐私设置：允许他人在我的主页查看玩家标记' })
  @IsOptional()
  @IsBoolean()
  showPlayerBadges?: boolean;

  @ApiPropertyOptional({ example: true, description: '隐私设置：允许他人在我的主页查看收藏/订阅' })
  @IsOptional()
  @IsBoolean()
  showBookmarks?: boolean;
}
