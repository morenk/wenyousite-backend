import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import configuration from '../config/configuration';
import { validate } from '../config/env.validation';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../moderation/audit.module';
import { redisConnectionOptions } from '../redis/redis-connection';
import { configureRedisQueues } from '../redis/redis-queue';
import { TextFontCoreModule } from './text-font-core.module';
import { FontProcessor } from './font.processor';
import { FontProcessingService } from './font-processing.service';
import { FontSandboxService } from './font-sandbox.service';

configureRedisQueues();
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env.local', '.env'],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ connection: redisConnectionOptions(config) }),
    }),
    BullModule.registerQueue({ name: 'text-font' }),
    PrismaModule,
    AuditModule,
    TextFontCoreModule,
  ],
  providers: [FontProcessor, FontProcessingService, FontSandboxService],
})
export class FontWorkerModule {}
