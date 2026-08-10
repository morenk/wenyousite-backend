import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SiteOperationalSettingsService } from '../../admin/site-operational-settings.service';

/** 紧急开关只拦截用户写入；举报、申诉和站务修复入口始终可用。 */
@Injectable()
export class OperationalSettingsGuard implements CanActivate {
  constructor(private readonly settings: SiteOperationalSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ url: string; method: string }>();
    await this.settings.assertRequestAllowed(request.url.split('?', 1)[0], request.method);
    return true;
  }
}
