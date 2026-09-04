import { Injectable } from '@nestjs/common';
import { ExperienceEventType, Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  beijingDateKey,
  EXPERIENCE_RULES,
  GrantableExperienceType,
  levelForExperience,
  progressionFor,
} from './progression.constants';

export interface GrantExperienceInput {
  userId: string;
  type: GrantableExperienceType;
  idempotencyKey: string;
  occurredAt?: Date;
  sourceType?: string;
  sourceId?: string;
}

export interface GrantExperienceResult {
  granted: boolean;
  delta: number;
  previousLevel: number;
  progression: ReturnType<typeof progressionFor>;
}

@Injectable()
export class ProgressionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  grant(input: GrantExperienceInput): Promise<GrantExperienceResult> {
    return this.prisma.$transaction((tx) => this.grantInTransaction(tx, input));
  }

  /** 同一业务事件共用事务，并按用户 ID 排序拿锁，减少连接和交叉锁等待。 */
  async grantMany(inputs: GrantExperienceInput[]): Promise<GrantExperienceResult[]> {
    if (inputs.length === 0) return [];
    const ordered = inputs
      .map((input, index) => ({ input, index }))
      .sort((left, right) => left.input.userId.localeCompare(right.input.userId));
    return this.prisma.$transaction(async (tx) => {
      const results = new Array<GrantExperienceResult>(inputs.length);
      for (const { input, index } of ordered) {
        results[index] = await this.grantInTransaction(tx, input);
      }
      return results;
    });
  }

  async grantInTransaction(
    tx: Prisma.TransactionClient,
    input: GrantExperienceInput,
  ): Promise<GrantExperienceResult> {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR UPDATE
    `);

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { experience: true, level: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      return {
        granted: false,
        delta: 0,
        previousLevel: user?.level ?? 1,
        progression: progressionFor(user?.experience ?? 0),
      };
    }

    const existing = await tx.experienceEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { delta: true },
    });
    if (existing) {
      return {
        granted: false,
        delta: 0,
        previousLevel: user.level,
        progression: progressionFor(user.experience),
      };
    }

    const rule = EXPERIENCE_RULES[input.type];
    const dateKey = beijingDateKey(input.occurredAt);
    const stat = await tx.experienceDailyStat.upsert({
      where: { userId_dateKey: { userId: input.userId, dateKey } },
      create: { userId: input.userId, dateKey },
      update: {},
    });
    if (stat[rule.counter] >= rule.dailyCap) {
      return {
        granted: false,
        delta: 0,
        previousLevel: user.level,
        progression: progressionFor(user.experience),
      };
    }

    const event = await tx.experienceEvent.create({
      data: {
        userId: input.userId,
        type: input.type,
        delta: rule.delta,
        dateKey,
        idempotencyKey: input.idempotencyKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    await tx.experienceDailyStat.update({
      where: { userId_dateKey: { userId: input.userId, dateKey } },
      data: {
        [rule.counter]: { increment: 1 },
        experienceAwarded: { increment: rule.delta },
      },
    });

    const experience = user.experience + rule.delta;
    const level = levelForExperience(experience);
    await tx.user.update({
      where: { id: input.userId },
      data: { experience, level },
    });

    if (level > user.level) {
      await this.outbox.enqueue(tx, {
        eventType: 'user.level_up',
        aggregateType: 'User',
        aggregateId: input.userId,
        eventKey: `level-up:${event.id}:${level}`,
        payload: {
          userId: input.userId,
          previousLevel: user.level,
          level,
          experience,
        },
      });
    }

    return {
      granted: true,
      delta: rule.delta,
      previousLevel: user.level,
      progression: progressionFor(experience),
    };
  }

  /** 为未来处罚流程预留：撤销单条正向经验事件，并按有效经验同步降级。 */
  async reverse(eventId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.experienceEvent.findUnique({ where: { id: eventId } });
      if (!original || original.delta <= 0 || original.reversedAt) return null;

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "users" WHERE "id" = ${original.userId} FOR UPDATE
      `);
      const user = await tx.user.findUniqueOrThrow({ where: { id: original.userId } });
      const existing = await tx.experienceEvent.findUnique({
        where: { idempotencyKey: `experience-reversal:${eventId}` },
      });
      if (existing) return progressionFor(user.experience);

      const experience = Math.max(0, user.experience - original.delta);
      const level = levelForExperience(experience);
      await tx.experienceEvent.update({
        where: { id: eventId },
        data: { reversedAt: new Date() },
      });
      await tx.experienceEvent.create({
        data: {
          userId: original.userId,
          type: ExperienceEventType.REVERSAL,
          delta: -original.delta,
          dateKey: beijingDateKey(),
          idempotencyKey: `experience-reversal:${eventId}`,
          sourceType: 'ExperienceEvent',
          sourceId: eventId,
          note: reason,
        },
      });
      await tx.user.update({
        where: { id: original.userId },
        data: { experience, level },
      });
      return progressionFor(experience);
    });
  }
}
