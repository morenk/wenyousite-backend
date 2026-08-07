import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface MobilePushMessage {
  token: string;
  kind: 'notification' | 'direct_message';
  collapseKey: string;
  data: Record<string, string>;
}

@Injectable()
export class FirebasePushProvider implements OnModuleInit {
  private readonly logger = new Logger(FirebasePushProvider.name);
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.enabled = this.config.get<boolean>('push.enabled') ?? false;
    if (!this.enabled) return;
    if (getApps().length === 0) {
      initializeApp({
        credential: applicationDefault(),
        projectId: this.config.get<string>('push.firebaseProjectId'),
      });
    }
    this.logger.log('Firebase mobile push provider enabled');
  }

  isEnabled() {
    return this.enabled;
  }

  async send(message: MobilePushMessage) {
    if (!this.enabled) return;
    const body = message.kind === 'direct_message' ? '你有一条新私聊消息' : '你有一条新通知';
    await getMessaging().send({
      token: message.token,
      notification: { title: '温油站', body },
      data: { schemaVersion: '1', kind: message.kind, ...message.data },
      android: { collapseKey: message.collapseKey },
      apns: { headers: { 'apns-collapse-id': message.collapseKey } },
    });
  }
}
