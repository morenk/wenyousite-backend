import { Module } from '@nestjs/common';
import { AccessPolicyModule } from '../access/access-policy.module';
import { MomentsModule } from '../moments/moments.module';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { GalleryAccessService } from './gallery-access.service';
import { GalleryRowsService } from './gallery-rows.service';
@Module({
  imports: [AccessPolicyModule, MomentsModule],
  controllers: [GalleryController],
  providers: [GalleryService, GalleryAccessService, GalleryRowsService],
})
export class GalleryModule {}
