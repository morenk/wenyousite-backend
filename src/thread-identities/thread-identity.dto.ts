import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ description: '原始目标 href；与原 label 配对匹配节点，不以 occurrence 或 userId 单独匹配' })
  sourceHref?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: '稳定目标角色 ID；ACCOUNT/legacy 为 null，不随关闭/归档丢失。仅声明 Markdown 6 的读取返回角色目标' })
  targetIdentityId?: string | null;
  @ApiPropertyOptional({ description: '角色所属主题；跨页面身份卡读取使用，不能猜当前页面主题' })
  threadId?: string;

  @ApiProperty() userId!: string;
  @ApiProperty({
    description: '正文 canonical mention 的原始标签（不含 @），与 sourceHref 共同作为映射键；旧 bare 兼容 userId+label',
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
  @ApiPropertyOptional({ type: String, nullable: true, description: '本人保存的资料楼层绑定；不代表当前可读取。资料正文必须另经 postsFindById 授权读取' })
  profilePostId?: string | null;
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) nickname!: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarMediaId!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
}
export class ThreadIdentityStateDto {
  @ApiPropertyOptional({ enum: ['NONE', 'AVAILABLE', 'UNAVAILABLE'], description: 'NONE：无可展示绑定（含身份关闭/归档/资格失效/空身份）；AVAILABLE：可读取当前资料；UNAVAILABLE：有效角色的绑定当前不可读。不可用不提供原因或目标 ID' })
  profilePostStatus?: 'NONE' | 'AVAILABLE' | 'UNAVAILABLE';
  @ApiPropertyOptional({ type: String, nullable: true, description: '同一角色当前可读的资料楼层 ID；关闭、失去资格、空身份、归档、目标不可读时为 null。每次打开卡片重新读取，再调用 postsFindById，禁止缓存正文绕过授权' })
  profilePostId?: string | null;
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
  @ApiPropertyOptional({ type: String, nullable: true, description: '本主题内当前可读且可用的楼层、楼中楼或子贴正文 ID，可引用他人发言；省略保留，null 清除；不接受 URL' })
  @IsOptional()
  @IsString()
  @IsCuid()
  profilePostId?: string | null;
  @ApiPropertyOptional({ description: '显式解除资料绑定，供省略 null 的客户端使用；不能与非空 profilePostId 同时提供' })
  @IsOptional()
  @IsBoolean()
  clearProfilePost?: boolean;

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

/** 新集合接口不自动改变旧单身份锚点。 */
export class CreateRpIdentityDto extends OmitType(UpdateThreadIdentityDto, ['version'] as const) {}
export class UpdateRpIdentityDto extends OmitType(UpdateThreadIdentityDto, ['version'] as const) {
  @ApiProperty({ minimum: 1, description: '所选角色版本；409/40002 时重新读取，不能覆盖另一角色' })
  @IsInt()
  @Min(1)
  version!: number;
}
export class DeleteRpIdentityDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
export class RpIdentityStateDto extends ThreadIdentityStateDto {
  @ApiProperty({ description: '本人可删除未归档角色，关闭功能或撤资格后也可删除' })
  canDelete!: boolean;
  @ApiProperty({ description: '稳定角色 ID，删除后不会复用' }) identityId!: string;
  @ApiProperty({ description: '已删除角色仅保留历史展示与账号；当前 display 为 null' })
  deleted!: boolean;
  @ApiProperty({ description: '仅旧 single 协议内部锚点；不是新端的默认或候选优先级' })
  compatibilityIdentity!: boolean;
}
export class RpIdentityCollectionDto {
  @ApiProperty() threadId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() eligible!: boolean;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({
    minimum: 0,
    maximum: 10,
    description: '未删除身份数；清空资料仍占一个名额，删除释放名额',
  })
  activeCount!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '旧 single 接口的明确锚点；首次角色绑定，删除后不自动接管',
  })
  compatibilityIdentityId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '固定 null；新空白编辑器默认 ACCOUNT，不覆盖恢复的显式草稿',
  })
  defaultIdentityId!: string | null;
  @ApiProperty({ type: [RpIdentityStateDto] }) identities!: RpIdentityStateDto[];
  @ApiProperty({ type: ThreadIdentityAccountDto }) account!: ThreadIdentityAccountDto;
}
