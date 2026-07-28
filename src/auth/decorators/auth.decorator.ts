import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { VerifiedGuard } from '../../common/guards/verified.guard';

/** @Auth() — JWT 登录 + 邮箱验证，用于所有写操作 */
export function Auth() {
  return applyDecorators(UseGuards(JwtAuthGuard, VerifiedGuard));
}

/** @AuthRead() — 仅 JWT 登录，不校验邮箱，用于纯读操作 */
export function AuthRead() {
  return applyDecorators(UseGuards(JwtAuthGuard));
}
