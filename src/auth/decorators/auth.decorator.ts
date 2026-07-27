import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { VerifiedGuard } from '../../common/guards/verified.guard';

/** @Auth() — JWT 登录 + 邮箱验证，用于写操作（发帖、创建子贴等） */
export function Auth() {
  return applyDecorators(UseGuards(JwtAuthGuard, VerifiedGuard));
}

/** @AuthRead() — 仅 JWT 登录，不校验邮箱，用于读操作（通知、订阅等） */
export function AuthRead() {
  return applyDecorators(UseGuards(JwtAuthGuard));
}
