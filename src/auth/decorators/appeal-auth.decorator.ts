import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtension } from '@nestjs/swagger';
import { VerifiedGuard } from '../../common/guards/verified.guard';
import { AppealAccessGuard } from '../guards/appeal-access.guard';

/** 普通已验证会话或申诉专用 Bearer 凭据。 */
export function AppealAuth() {
  return applyDecorators(
    UseGuards(AppealAccessGuard, VerifiedGuard),
    ApiBearerAuth(),
    ApiBearerAuth('appealBearer'),
    ApiExtension('x-auth-mode', 'appeal'),
  );
}
