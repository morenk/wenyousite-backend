import { FontWorkDirectoryService } from './font-work-directory.service';
import { Module } from '@nestjs/common';
import { FontStorageService } from './font-storage.service';
import { FontQueryService } from './font-query.service';
import { FontReadinessService } from './font-readiness.service';
import { ObjectStorageModule } from '../storage/object-storage.module';

@Module({
  imports: [ObjectStorageModule],
  providers: [FontStorageService, FontQueryService, FontWorkDirectoryService, FontReadinessService],
  exports: [FontStorageService, FontQueryService, FontWorkDirectoryService, FontReadinessService],
})
export class TextFontCoreModule {}
