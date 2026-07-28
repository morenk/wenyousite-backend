import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';

/** 更新成员信息 DTO */
export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: ['COLLABORATOR', 'PARTICIPANT'], description: '成员角色' })
  @IsOptional()
  @IsString()
  @IsIn(['COLLABORATOR', 'PARTICIPANT'])
  role?: string;

  @ApiPropertyOptional({ description: '是否标记为玩家' })
  @IsOptional()
  @IsBoolean()
  playerMarked?: boolean;
}
