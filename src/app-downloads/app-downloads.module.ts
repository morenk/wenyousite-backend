import { Module } from '@nestjs/common';
import { AppDownloadsController } from './app-downloads.controller';

@Module({ controllers: [AppDownloadsController] })
export class AppDownloadsModule {}
