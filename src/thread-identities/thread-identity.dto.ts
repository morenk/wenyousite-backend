import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { MediaDisplayResponseDto } from '../media/dto/media-display.dto';
import { IsCuid } from '../common/decorators/is-cuid.decorator';

export class RpIdentityResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: '实际展示昵称，已应用账号缺省值' }) nickname!: string;
  @ApiProperty({ type: String, nullable: true }) avatar!: string | null;
  @ApiPropertyOptional({ type: MediaDisplayResponseDto, nullable: true })
  avatarDisplay?: MediaDisplayResponseDto | null;
}
export class MentionIdentityDisplayDto {
  @ApiProperty() userId!: string;
  @ApiProperty({
    description: '正文 canonical mention 的原始标签（不含 @），与 userId 共同作为映射键',
  })
  label!: string;
  @ApiProperty({ description: '此次阅读应显示的名字；关闭时为账号用户名' }) displayName!: string;
  @ApiProperty({ type: String, nullable: true }) identityId!: string | null;
}
export class ThreadIdentityAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) avatar!: string | null;
}
export class ThreadIdentityProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) nickname!: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarMediaId!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
}
export class ThreadIdentityStateDto {
  @ApiProperty() threadId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: '当前是否具有楼主、协作者或玩家资格；不代表发言权限' })
  eligible!: boolean;
  @ApiProperty({ description: '当前访问者能否编辑此身份' }) canEdit!: boolean;
  @ApiProperty({ type: ThreadIdentityProfileDto, nullable: true })
  identity!: ThreadIdentityProfileDto | null;
  @ApiProperty({ type: RpIdentityResponseDto, nullable: true })
  display!: RpIdentityResponseDto | null;
  @ApiProperty({ type: ThreadIdentityAccountDto }) account!: ThreadIdentityAccountDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '仅本人读取返回。新发言传 identityToken；409 后保留草稿并重新读取确认',
  })
  identityToken!: string | null;
}
export class SetThreadIdentityEnabledDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class ThreadIdentitySettingsDto {
  @ApiProperty() enabled!: boolean;
}
export class UpdateThreadIdentityDto {
  @ApiPropertyOptional({
    description: '显式清除昵称，供省略 null 的客户端使用；不能与非空 nickname 同时提供',
  })
  @IsOptional()
  @IsBoolean()
  clearNickname?: boolean;
  @ApiPropertyOptional({ description: '显式清除头像；不能与非空 avatarMediaId 同时提供' })
  @IsOptional()
  @IsBoolean()
  clearAvatar?: boolean;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 24,
    description:
      '允许重名、空格及标点；去除首尾空白，空字符串清除。不允许反斜线、方括号、HTML括号或控制字符',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(24)
  @Matches(/^[^\\[\]<>\p{Cc}\p{Cf}]+$/u)
  nickname?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '本人已完成的 AVATAR 媒体；null 清除，不接受任意 URL',
  })
  @IsOptional()
  @IsString()
  @IsCuid()
  avatarMediaId?: string | null;
  @ApiPropertyOptional({ minimum: 1, description: '已有身份的乐观锁版本；省略兼容首次保存' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
