import { AudioRuntimeModule } from '../media/audio-runtime.service';
import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';

@Module({ imports: [AudioRuntimeModule], controllers: [MetaController] })
export class MetaModule {}
