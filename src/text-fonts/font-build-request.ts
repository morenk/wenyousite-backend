import { Prisma, TextFontBuildJob } from '@prisma/client';
import { AuditService } from '../moderation/audit.service';
import { DOMAIN_EVENTS } from '../outbox/domain-events';
import { OutboxService } from '../outbox/outbox.service';
import { requireFontAuthorization } from './font-authorization';
import { fontBuildIdentity } from './font-build-identity';
import { FontActor, fontConfiguration } from './font-domain';

/** 调用者持有用户和字体状态锁；旧手工入口与简化意图账本共用排队事务。 */
export async function requestFontBuild(
  tx: Prisma.TransactionClient,
  previous: TextFontBuildJob,
  actor: FontActor,
  outbox: OutboxService,
  audit: AuditService,
): Promise<TextFontBuildJob> {
  if (previous.status !== 'DRAFT' && previous.status !== 'FAILED') return previous;
  const config = fontConfiguration(previous.configuration);
  requireFontAuthorization(
    config,
    previous.sourceSha256,
    previous.parametersVersion,
    previous.uploadAuthorization,
  );
  const build = await fontBuildIdentity(previous.sourceSha256, config, previous.parametersVersion);
  const job = await tx.textFontBuildJob.update({
    where: { id: previous.id },
    data: {
      status: 'QUEUED',
      attempt: { increment: 1 },
      buildKey: build.key,
      failureCode: null,
      failureReason: null,
      claimToken: null,
      leaseExpiresAt: null,
    },
  });
  await outbox.enqueue(tx, {
    eventType: DOMAIN_EVENTS.TEXT_FONT_BUILD_REQUESTED,
    aggregateType: 'text-font',
    aggregateId: job.id,
    eventKey: `text-font-build:${job.id}:${job.attempt}`,
    payload: { jobId: job.id, attempt: job.attempt },
  });
  await audit.record(
    {
      ...actor,
      action: 'TEXT_FONT_PROCESS_REQUESTED',
      targetType: 'TEXT_FONT',
      targetId: job.id,
      metadata: { attempt: job.attempt },
    },
    tx,
  );
  return job;
}
