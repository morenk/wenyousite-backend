import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 系统通知用户筛选条件 */
class UserConditionDto {
  @ApiProperty({
    description: '角色筛选（USER / ADMIN / SUPER_ADMIN）',
    required: false,
    isArray: true,
    enum: UserRole,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  role?: UserRole[];

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
  payload?: Record<string, unknown>;

  @ApiProperty({
    description: '接收者用户 ID 列表（手动指定，优先级高于条件筛选）',
    required: false,
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsCuid({ each: true })
  recipientIds?: string[];

  @ApiProperty({ description: '用户筛选条件（不指定则全站广播）', required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserConditionDto)
  conditions?: UserConditionDto;

  @ApiProperty({ description: '关联主题帖 ID（可选，前端跳转用）', required: false })
  @IsOptional()
  @IsCuid()
  threadId?: string;
}
