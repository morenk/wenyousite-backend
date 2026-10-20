import { TextFontsController } from './text-fonts.controller';
import { AudioRuntimeModule } from '../media/audio-runtime.service';
import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';

@Module({ imports: [AudioRuntimeModule], controllers: [MetaController, TextFontsController] })
export class MetaModule {}
