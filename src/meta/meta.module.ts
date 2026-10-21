import { TextFontsController } from './text-fonts.controller';
import { AudioRuntimeModule } from '../media/audio-runtime.service';
import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { TextFontCoreModule } from '../text-fonts/text-font-core.module';

@Module({
  imports: [AudioRuntimeModule, TextFontCoreModule],
  controllers: [MetaController, TextFontsController],
})
export class MetaModule {}
