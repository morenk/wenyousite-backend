import { IsString, IsOptional, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 发送系统通知 DTO */
export class SendSystemNotificationDto {
  @ApiProperty({ description: '通知正文' })
  @IsString()
  content: string;

  @ApiProperty({ description: '结构化数据（可选，供前端渲染）', required: false })
  @IsOptional()
  payload?: Record<string, any>;

  @ApiProperty({ description: '接收者用户 ID 列表（为空则全站广播）', required: false, isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recipientIds?: string[];

  @ApiProperty({ description: '关联主题帖 ID（可选，前端跳转用）', required: false })
  @IsOptional()
  @IsUUID('4')
  threadId?: string;
}
