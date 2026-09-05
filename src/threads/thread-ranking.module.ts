import { Module } from '@nestjs/common';
import { ThreadRankingService } from './thread-ranking.service';

@Module({ providers: [ThreadRankingService], exports: [ThreadRankingService] })
export class ThreadRankingModule {}
