import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ApplicationLifecycleService implements OnApplicationShutdown {
  private readonly logger = new Logger(ApplicationLifecycleService.name);

  onApplicationShutdown(signal?: string) {
    this.logger.log(`Application shutdown completed signal=${signal ?? 'unknown'}`);
  }
}
