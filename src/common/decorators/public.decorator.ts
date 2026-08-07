import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { IS_PUBLIC_KEY } from '../../auth/guards/jwt-auth.guard';

/** 标记路由为公开：跳过 JWT 认证，用于登录、注册等接口 */
export const Public = () => applyDecorators(
  SetMetadata(IS_PUBLIC_KEY, true),
  ApiExtension('x-auth-mode', 'public'),
);
