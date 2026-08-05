import { Global, Module } from '@nestjs/common';
import { DiceService } from './dice.service';

@Global()
@Module({
  providers: [DiceService],
  exports: [DiceService],
})
export class DiceModule {}
