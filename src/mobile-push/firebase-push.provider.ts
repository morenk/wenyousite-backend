import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

interface MobilePushMessageBase {
  token: string;
  collapseKey: string;
}

export type MobilePushMessage =
  | (MobilePushMessageBase & {
      kind: 'notification';
      data: { notificationId: string };
    })
  | (MobilePushMessageBase & {
      kind: 'direct_message';
      data: { conversationId: string; messageId: string };
    });

export type MobilePushData =
  | { schemaVersion: '1'; kind: 'notification'; notificationId: string }
  | {
      schemaVersion: '1';
      kind: 'direct_message';
      conversationId: string;
      messageId: string;
    };

/** 构建与 contracts/mobile-push-v1.schema.json 一致的 FCM data payload。 */
export function buildMobilePushData(message: MobilePushMessage): MobilePushData {
  if (message.kind === 'notification') {
    return { schemaVersion: '1', kind: 'notification', notificationId: message.data.notificationId };
  }
  return {
    schemaVersion: '1',
    kind: 'direct_message',
    conversationId: message.data.conversationId,
    messageId: message.data.messageId,
  };
}

@Injectable()
export class FirebasePushProvider implements OnModuleInit {
  private readonly logger = new Logger(FirebasePushProvider.name);
  private enabled = false;
  private ttlSeconds = 86_400;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.enabled = this.config.get<boolean>('push.enabled') ?? false;
    this.ttlSeconds = this.config.get<number>('push.ttlSeconds') ?? 86_400;
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
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    await getMessaging().send({
      token: message.token,
      notification: { title: '温油站', body },
      data: buildMobilePushData(message),
      android: { collapseKey: message.collapseKey, ttl: this.ttlSeconds * 1000 },
      apns: {
        headers: {
          'apns-collapse-id': message.collapseKey,
          'apns-expiration': String(expiresAt),
        },
      },
    });
  }
}
