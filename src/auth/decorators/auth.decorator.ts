import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtension } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';

/** @Auth() — JWT 登录，用于所有写操作或敏感操作 */
export function Auth() {
  return applyDecorators(
    UseGuards(JwtAuthGuard),
    ApiBearerAuth(),
    ApiExtension('x-auth-mode', 'authenticated'),
  );
}

/** @AuthRead() — 仅 JWT 登录，不校验邮箱，用于纯读操作 */
export function AuthRead() {
  return applyDecorators(
    UseGuards(JwtAuthGuard),
    ApiBearerAuth(),
    ApiExtension('x-auth-mode', 'authenticated'),
  );
}

/** @OptionalAuth() — 可选 JWT 认证：有 token 就挂载 user，没有也不抛异常 */
export function OptionalAuth() {
  return applyDecorators(
    UseGuards(OptionalJwtAuthGuard),
    ApiExtension('x-auth-mode', 'optional'),
  );
}
