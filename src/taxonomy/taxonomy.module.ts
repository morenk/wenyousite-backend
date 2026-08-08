import { Module } from '@nestjs/common';
import { ThreadCategoriesController } from './thread-categories.controller';
import { ThreadCategoriesService } from './thread-categories.service';

@Module({
  controllers: [ThreadCategoriesController],
  providers: [ThreadCategoriesService],
  exports: [ThreadCategoriesService],
})
export class TaxonomyModule {}
