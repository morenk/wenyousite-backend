import { IsString, IsOptional, IsArray, IsUUID, IsBoolean, IsDateString, IsIn, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** 系统通知用户筛选条件 */
class UserConditionDto {
  @ApiProperty({ description: '角色筛选（USER / ADMIN / SUPER_ADMIN）', required: false, isArray: true, enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] })
  @IsOptional()
  @IsArray()
  @IsIn(['USER', 'ADMIN', 'SUPER_ADMIN'], { each: true })
  role?: string[];

  @ApiProperty({ description: '邮箱验证状态筛选', required: false })
  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;

  @ApiProperty({ description: '注册时间起始（ISO 8601）', required: false })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiProperty({ description: '注册时间截止（ISO 8601）', required: false })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;
}

/** 发送系统通知 DTO */
export class SendSystemNotificationDto {
  @ApiProperty({ description: '通知正文' })
  @IsString()
  content: string;

  @ApiProperty({ description: '结构化数据（可选，供前端渲染）', required: false })
  @IsOptional()
  payload?: Record<string, any>;

  @ApiProperty({ description: '接收者用户 ID 列表（手动指定，优先级高于条件筛选）', required: false, isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recipientIds?: string[];

  @ApiProperty({ description: '用户筛选条件（不指定则全站广播）', required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserConditionDto)
  conditions?: UserConditionDto;

  @ApiProperty({ description: '关联主题帖 ID（可选，前端跳转用）', required: false })
  @IsOptional()
  @IsUUID('4')
  threadId?: string;
}
