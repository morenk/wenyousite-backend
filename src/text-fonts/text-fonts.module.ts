import { Module } from '@nestjs/common';
import { TextFontsV2Controller } from './text-fonts-v2.controller';
import { TextFontAvailabilityService } from './text-font-availability.service';

@Module({
  controllers: [TextFontsV2Controller],
  providers: [TextFontAvailabilityService],
  exports: [TextFontAvailabilityService],
})
export class TextFontsModule {}
