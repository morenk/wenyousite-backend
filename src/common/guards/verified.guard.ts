import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

const SKIP_VERIFIED_KEY = 'skipVerified';

export { SKIP_VERIFIED_KEY };

export const SkipVerified = () => SetMetadata(SKIP_VERIFIED_KEY, true);

/** 邮箱验证守卫：拦截未验证用户的所有写操作（发帖/关注/加入/修改资料/上传等） */
@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true;
    if (user.emailVerified === false) {
      throw new ForbiddenException('请先验证邮箱后再操作。如未收到邮件，可调用 /auth/resend-verification 重新获取');
    }
    return true;
  }
}
