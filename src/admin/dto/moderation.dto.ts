import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, AuditTargetType, UserRole, UserSanctionType } from '@prisma/client';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class SanctionUserDto {
  @ApiProperty({ enum: UserSanctionType })
  @IsEnum(UserSanctionType)
  type!: UserSanctionType;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ format: 'date-time', description: '暂停结束时间；永久封禁时不得传入' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class RevokeSanctionDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ModerateContentDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class UpdateAdminRoleDto {
  @ApiProperty({ enum: [UserRole.USER, UserRole.ADMIN] })
  @IsIn([UserRole.USER, UserRole.ADMIN])
  role!: 'USER' | 'ADMIN';

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class AdminUserQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: '用户名或邮箱关键词' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'BANNED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'BANNED'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

export class AuditLogQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditTargetType })
  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;
}

export class AdminContentParamsDto {
  @ApiProperty({ enum: ['thread', 'post', 'moment', 'moment_comment'] })
  @IsIn(['thread', 'post', 'moment', 'moment_comment'])
  type!: 'thread' | 'post' | 'moment' | 'moment_comment';

  @ApiProperty()
  @IsString()
  id!: string;
}
