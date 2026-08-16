import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { AUTH_MODE_KEY, AuthMode } from './auth-mode.constants';

/** 完全公开，不解析用户身份。 */
export const Public = () =>
  applyDecorators(
    SetMetadata(AUTH_MODE_KEY, AuthMode.PUBLIC),
    ApiExtension('x-auth-mode', 'public'),
  );
