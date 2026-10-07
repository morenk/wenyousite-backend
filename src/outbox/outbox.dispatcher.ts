import { BeforeApplicationShutdown, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertDomainEventPayload } from './domain-events';
import { outboxErrorDetails } from './outbox-error';

interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

/** 以短租约领取 Outbox 事件，等待所有异步监听器完成后再确认。 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private stopping = false;
  private currentDispatch: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    void this.dispatch().catch((error: unknown) => {
      this.logDispatchFailure('initial', error);
    });
  }

  async beforeApplicationShutdown() {
    this.stopping = true;
    try {
      await this.currentDispatch;
    } catch (error: unknown) {
      this.logDispatchFailure('shutdown', error);
    }
  }

  @Interval(1000)
  async scheduledDispatch(): Promise<void> {
    try {
      await this.dispatch();
    } catch (error: unknown) {
      this.logDispatchFailure('scheduled', error);
    }
  }

  async dispatch(): Promise<void> {
    if (this.stopping || this.currentDispatch) return;
    const current = this.dispatchBatch();
    this.currentDispatch = current;
    try {
      await current;
    } finally {
      if (this.currentDispatch === current) this.currentDispatch = null;
    }
  }

  private async dispatchBatch() {
    for (let count = 0; count < 50 && !this.stopping; count++) {
      const [row] = await this.claim(1);
      if (!row) return;
      await this.deliver(row);
    }
  }

  private logDispatchFailure(stage: 'initial' | 'scheduled' | 'shutdown', error: unknown) {
    this.logger.error({ stage, ...outboxErrorDetails(error) });
  }

  private claim(limit: number) {
    return this.prisma.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
      WITH pending AS (
        SELECT "id"
        FROM "domain_outbox"
        WHERE "processed_at" IS NULL
          AND "available_at" <= NOW()
        ORDER BY "created_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "domain_outbox" AS outbox
      SET
        "attempts" = outbox."attempts" + 1,
        "available_at" = NOW() + INTERVAL '60 seconds',
        "updated_at" = NOW()
      FROM pending
      WHERE outbox."id" = pending."id"
      RETURNING
        outbox."id",
        outbox."event_type" AS "eventType",
        outbox."payload",
        outbox."attempts"
    `);
  }

  private async deliver(row: ClaimedOutboxEvent): Promise<void> {
    let stage: 'payload' | 'listener' | 'delivery' | 'acknowledgement' = 'payload';
    try {
      assertDomainEventPayload(row.eventType, row.payload);
      stage = 'listener';
      const listeners = this.events.listeners(row.eventType);
      if (listeners.length === 0) {
        throw new Error(`No listener registered for domain event: ${row.eventType}`);
      }
      stage = 'delivery';
      // emitAsync 内部 Promise.all 会提前拒绝；等待同次投递的全部副作用再安排重试。
      const context: EventEmitter2 & { event?: string } = this.events;
      const results = await Promise.allSettled(
        listeners.map((listener) =>
          Promise.resolve().then(() => {
            context.event = row.eventType;
            return listener.call(this.events, row.payload);
          }),
        ),
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      stage = 'acknowledgement';
      await this.prisma.domainOutbox.updateMany({
        where: { id: row.id, processedAt: null, attempts: row.attempts },
        data: { processedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const details = { stage, ...outboxErrorDetails(error) };
      const retrySeconds = Math.min(300, Math.max(5, row.attempts * 10));
      await this.prisma.domainOutbox.updateMany({
        where: { id: row.id, processedAt: null, attempts: row.attempts },
        data: {
          lastError: JSON.stringify(details),
          availableAt: new Date(Date.now() + retrySeconds * 1000),
        },
      });
      this.logger.error({ outboxId: row.id, attempt: row.attempts, ...details });
    }
  }
}
