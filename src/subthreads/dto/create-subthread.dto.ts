import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsIn,
  IsNumber,
  IsUUID,
} from 'class-validator';

/** 创建子贴 DTO */
export class CreateSubthreadDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '客户端创建幂等键；同一次提交和网络重试必须复用',
  })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;

  @ApiProperty({ example: '设定区', description: '子贴标题', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({
    example: '这里是世界观设定...',
    description: '子贴正文（kind=BODY，可选，留空仅创建空子贴）',
    maxLength: 10000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ example: 1, description: '排序序号，越小越靠前' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({
    example: 'PLAYERS',
    enum: ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'],
    default: 'PARTICIPANTS',
    description:
      'PARTICIPANTS=所有参与人可发帖, COLLABORATORS=仅协作者可发帖, PLAYERS=仅被标记为玩家的参与人可发帖',
  })
  @IsOptional()
  @IsString()
  @IsIn(['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'])
  postingPolicy?: string;
}
