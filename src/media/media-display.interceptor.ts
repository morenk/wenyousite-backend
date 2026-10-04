import { IdentityProjectionService } from '../thread-identities/identity-projection.service';
import { FastifyRequest } from 'fastify';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { mergeMap } from 'rxjs/operators';
import { MediaDisplayProjectionService } from './media-display-projection.service';
import { sanitizePublicUserSummaries } from '../common/user-summary';
import { PaginatedResult } from '../common/dto/paginated-result';

/** 权限服务完成后统一增强响应；不在 common 响应层引入媒体领域查询。 */
@Injectable()
export class MediaDisplayInterceptor implements NestInterceptor {
  constructor(private readonly projection: MediaDisplayProjectionService, private readonly identities: IdentityProjectionService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(mergeMap(async (raw: unknown) => {
      const req = context.switchToHttp().getRequest<FastifyRequest>();
      const params = req.params as Record<string, string> | undefined;
      const query = req.query as Record<string, string> | undefined;
      const route = req.routeOptions?.url ?? '';
      const threadDetail = /threads\/:id$/.test(route);
      const identityContext = { threadId: params?.threadId ?? (threadDetail ? params?.id : query?.threadId),
        subthreadId: params?.subthreadId, postId: params?.postId ?? params?.id,
        currentUsers: threadDetail || /members|authors|mention-candidates/.test(route), viewerId: req.user?.id };
      await this.identities.project(raw instanceof PaginatedResult ? raw.items : raw, identityContext);
      if (raw instanceof PaginatedResult) {
        return new PaginatedResult(await this.projection.project(sanitizePublicUserSummaries(raw.items)), raw.pagination);
      }
      return this.projection.project(sanitizePublicUserSummaries(raw));
    }));
  }
}
