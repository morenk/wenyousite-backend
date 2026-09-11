import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { mergeMap } from 'rxjs/operators';
import { MediaDisplayProjectionService } from './media-display-projection.service';
import { sanitizePublicUserSummaries } from '../common/user-summary';
import { PaginatedResult } from '../common/dto/paginated-result';

/** 权限服务完成后统一增强响应；不在 common 响应层引入媒体领域查询。 */
@Injectable()
export class MediaDisplayInterceptor implements NestInterceptor {
  constructor(private readonly projection: MediaDisplayProjectionService) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(mergeMap(async (raw: unknown) => {
      if (raw instanceof PaginatedResult) {
        return new PaginatedResult(await this.projection.project(sanitizePublicUserSummaries(raw.items)), raw.pagination);
      }
      return this.projection.project(sanitizePublicUserSummaries(raw));
    }));
  }
}
