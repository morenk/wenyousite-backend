import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';
import type { MemberRole } from '@prisma/client';

/** 更新参与人信息 DTO */
export class UpdateMemberDto {
  @ApiPropertyOptional({
    enum: ['COLLABORATOR', 'PARTICIPANT'],
    description: '角色：COLLABORATOR=协作者, PARTICIPANT=参与人',
  })
  @IsOptional()
  @IsString()
  @IsIn(['COLLABORATOR', 'PARTICIPANT'])
  role?: Exclude<MemberRole, 'OWNER'>;

  @ApiPropertyOptional({
    example: true,
    description: '是否标记为玩家（决定能否在 postingPolicy=PLAYERS 的子贴中发帖）',
  })
  @IsOptional()
  @IsBoolean()
  playerMarked?: boolean;
}
