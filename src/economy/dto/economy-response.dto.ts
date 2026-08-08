import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';

export class ProgressionResponseDto {
  @ApiProperty({ minimum: 1, maximum: 9 })
  level!: number;

  @ApiProperty({ minimum: 0 })
  experience!: number;

  @ApiProperty({ minimum: 0 })
  currentLevelExperience!: number;

  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  nextLevelExperience!: number | null;
}

export class WalletResponseDto {
  @ApiProperty({ type: String, pattern: '^\\d+$', example: '42' })
  balance!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$', example: '120' })
  receivedTipTotal!: string;

  @ApiProperty({ minimum: 0 })
  receivedTipCount!: number;
}

export class DailyCheckInResponseDto {
  @ApiProperty({ description: 'true 仅表示本次请求实际完成领取' })
  claimedNow!: boolean;

  @ApiProperty({ example: '2026-08-07', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  date!: string;

  @ApiProperty({ type: String, enum: ['1', '2', '3'] })
  rewardAmount!: string;

  @ApiProperty({ example: 2 })
  experienceAwarded!: number;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  balance!: string;

  @ApiProperty({ type: ProgressionResponseDto })
  progression!: ProgressionResponseDto;
}

export class TipResponseDto {
  @ApiProperty()
  transactionId!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  grossAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  recipientAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  platformAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$', description: '付款后余额' })
  balance!: string;

  @ApiPropertyOptional({ type: String, pattern: '^\\d+$', description: '主题累计投入总额' })
  threadTipTotal?: string;

  @ApiPropertyOptional({ type: String, pattern: '^\\d+$', description: '动态累计加油总额' })
  momentTipTotal?: string;

  @ApiProperty({ type: String, pattern: '^\\d+$', description: '收款人累计收到的用户投入总额' })
  recipientTipTotal!: string;

  @ApiProperty({ minimum: 0 })
  recipientTipCount!: number;
}

export class WalletTransactionTargetResponseDto {
  @ApiProperty({ enum: ['THREAD', 'USER', 'MOMENT', 'NONE'] })
  type!: 'THREAD' | 'USER' | 'MOMENT' | 'NONE';

  @ApiProperty({ type: String, nullable: true })
  id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;
}

export class WalletTransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['DAILY_CHECK_IN', 'TIP'] })
  type!: 'DAILY_CHECK_IN' | 'TIP';

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  direction!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, pattern: '^\\d+$', description: '该用户本次实际收入或支出' })
  amount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  grossAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  recipientAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  platformAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  balanceAfter!: string;

  @ApiProperty({ type: PostAuthorResponseDto, nullable: true })
  counterparty!: PostAuthorResponseDto | null;

  @ApiProperty({ type: WalletTransactionTargetResponseDto })
  target!: WalletTransactionTargetResponseDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
