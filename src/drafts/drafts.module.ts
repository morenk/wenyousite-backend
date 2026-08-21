import { Module } from '@nestjs/common';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';
import { StickersModule } from '../stickers/stickers.module';
import { MediaReferenceModule } from '../media/media-reference.module';
import { DiceModule } from '../dice/dice.module';

/** 草稿模块：5 槽位自动/手动保存 */
@Module({
  imports: [StickersModule, MediaReferenceModule, DiceModule],
  controllers: [DraftsController],
  providers: [DraftsService],
  exports: [DraftsService],
})
export class DraftsModule {}
