import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertDomainEventPayload } from './domain-events';

interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

/** 以短租约领取 Outbox 事件，等待所有异步监听器完成后再确认。 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    void this.dispatch();
  }

  @Interval(1000)
  async dispatch(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const rows = await this.claim(50);
      for (const row of rows) {
        await this.deliver(row);
      }
    } finally {
      this.dispatching = false;
    }
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
    try {
      assertDomainEventPayload(row.eventType, row.payload);
      if (this.events.listenerCount(row.eventType) === 0) {
        throw new Error(`No listener registered for domain event: ${row.eventType}`);
      }
      await this.events.emitAsync(row.eventType, row.payload);
      await this.prisma.domainOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: { processedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retrySeconds = Math.min(300, Math.max(5, row.attempts * 10));
      await this.prisma.domainOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: {
          lastError: message.slice(0, 2000),
          availableAt: new Date(Date.now() + retrySeconds * 1000),
        },
      });
      this.logger.error(
        `Outbox delivery failed id=${row.id} type=${row.eventType} attempt=${row.attempts}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
