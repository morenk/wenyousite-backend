import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterMobileDeviceDto {
  @ApiProperty({ minLength: 20, maxLength: 4096, description: 'Firebase Cloud Messaging registration token' })
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  pushToken!: string;

  @ApiProperty({ enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;

  @ApiPropertyOptional({ maxLength: 32, example: 'zh-CN' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string;
}

export class MobileDeviceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['android', 'ios'] })
  platform!: 'android' | 'ios';

  @ApiProperty({ type: String, nullable: true })
  appVersion!: string | null;

  @ApiProperty({ type: String, nullable: true })
  locale!: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  lastSeenAt!: Date;
}
