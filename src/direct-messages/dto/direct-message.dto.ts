import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

export class CreateDirectMessageDto {
  @ApiPropertyOptional({
    maxLength: 1000,
    description: '纯文字正文，保留换行；与 mediaId 至少提供一项；不能和 stickerAssetId 同时提供',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  @ApiPropertyOptional({ description: '已完成处理且属于发送者的图片 ID；每条最多一张' })
  @IsOptional()
  @IsString()
  @IsCuid()
  mediaId?: string;

  @ApiPropertyOptional({ description: '当前收藏夹中的表情资产 ID；必须作为独立消息发送' })
  @IsOptional()
  @IsString()
  @IsCuid()
  stickerAssetId?: string;

  @ApiProperty({ format: 'uuid', description: '客户端幂等键；重试同一次发送时必须复用' })
  @IsUUID('4')
  clientRequestId!: string;
}

export class CreateDirectConversationDto extends CreateDirectMessageDto {
  @ApiProperty({ description: '接收用户 ID' })
  @IsString()
  @IsCuid()
  recipientId!: string;
}

export class MarkDirectConversationReadDto {
  @ApiProperty({ description: '客户端实际已展示的最后一条消息 ID' })
  @IsString()
  @IsCuid()
  throughMessageId!: string;
}
