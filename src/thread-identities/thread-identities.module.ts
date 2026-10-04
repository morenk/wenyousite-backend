import { Module } from '@nestjs/common';
import { AccessPolicyModule } from '../access/access-policy.module';
import { MediaReferenceModule } from '../media/media-reference.module';
import { ThreadIdentitiesService } from './thread-identities.service';
import { ThreadIdentitiesController } from './thread-identities.controller';
import { IdentityProjectionService } from './identity-projection.service';
@Module({
  imports: [AccessPolicyModule, MediaReferenceModule],
  controllers: [ThreadIdentitiesController],
  providers: [ThreadIdentitiesService, IdentityProjectionService],
  exports: [ThreadIdentitiesService, IdentityProjectionService],
})
export class ThreadIdentitiesModule {}
