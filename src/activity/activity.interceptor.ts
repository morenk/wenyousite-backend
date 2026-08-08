import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';
import { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ActivityService } from './activity.service';

const EXCLUDED_PREFIXES = ['/api/v1/admin', '/api/v1/notifications'];

type AuthenticatedRequest = FastifyRequest & { user?: CurrentUserPayload };

/** 成功请求活跃采集：只记录普通用户，不记录路径、IP、管理员或失败请求。 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActivityInterceptor.name);

  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const path = request.url.split('?')[0];
    const eligible =
      request.method !== 'OPTIONS' &&
      user?.role === 'USER' &&
      !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));

    return next.handle().pipe(
      tap(() => {
        if (!eligible || !user) return;
        void this.activity.record(user.id).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'unknown activity error';
          this.logger.warn(`Failed to persist daily activity: ${message}`);
        });
      }),
    );
  }
}
