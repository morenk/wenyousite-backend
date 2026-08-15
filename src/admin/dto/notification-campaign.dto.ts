import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { NotificationCampaignStatus } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class NotificationAudienceDto {
  @ApiPropertyOptional({ enum: ['USER', 'ADMIN', 'SUPER_ADMIN'], isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(['USER', 'ADMIN', 'SUPER_ADMIN'], { each: true })
  roles?: Array<'USER' | 'ADMIN' | 'SUPER_ADMIN'>;

}

export class CreateNotificationCampaignDto {
  @ApiProperty({ minLength: 1, maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  scheduledAt!: string;

  @ApiPropertyOptional({ type: NotificationAudienceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationAudienceDto)
  audience?: NotificationAudienceDto;

  @ApiPropertyOptional({ enum: ['THREAD'] })
  @IsOptional()
  @IsIn(['THREAD'])
  destinationType?: 'THREAD';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationId?: string;
}

export class NotificationCampaignQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: '标题或正文关键词' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: NotificationCampaignStatus })
  @IsOptional()
  @IsEnum(NotificationCampaignStatus)
  status?: NotificationCampaignStatus;

  @ApiPropertyOptional({ enum: ['THREAD', 'NONE'], description: '是否配置主题帖跳转目标' })
  @IsOptional()
  @IsIn(['THREAD', 'NONE'])
  destination?: 'THREAD' | 'NONE';
}
