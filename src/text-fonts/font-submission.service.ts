import { Injectable } from '@nestjs/common';
import { Prisma, TextFontBuildJob } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from '../moderation/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { FontConfigurationDto, FontSourceQueryDto } from './dto/font-admin.dto';
import {
  CreateFontSubmissionDto,
  FontLanguage,
  FontSubmissionDto,
} from './dto/font-management.dto';
import { canonicalFontJson } from './font-build-identity';
import { requestFontBuild } from './font-build-request';
import {
  FontActor,
  bumpFontListing,
  fontConfiguration,
  fontConflict,
  fontIdentity,
  fontJobDto,
  fontJson,
  fontSha,
  lockFontActor,
  lockFontState,
  newFontId,
} from './font-domain';
import { FONT_LANGUAGE_SPECIMENS, FONT_UPLOAD_RULE_VERSION } from './font-management-contract';
import { publishFontCatalog } from './font-catalog-publisher';
import { FONT_SORT_ORDER_LIMIT, FONT_SOURCE_MAX_BYTES } from './font-protocol';
import { FontStorageService } from './font-storage.service';

const include = { family: true, job: true } satisfies Prisma.TextFontSubmissionInclude;
type Submission = Prisma.TextFontSubmissionGetPayload<{ include: typeof include }>;
function conflict(): never {
  throw new BusinessException(
    ErrorCode.TEXT_FONT_SUBMISSION_CONFLICT,
    '此提交标识已绑定其他内容，请恢复原提交或重新创建',
    409,
  );
}
function response(submission: Submission): FontSubmissionDto {
  const config = fontConfiguration(submission.configuration);
  return {
    submissionId: submission.id,
    familyId: submission.familyId,
    familyRevision: submission.family.revision,
    name: config.name,
    language: config.designLanguage,
    sortOrder: config.sortOrder,
    authorizationRuleVersion: FONT_UPLOAD_RULE_VERSION,
    job: submission.job ? fontJobDto(submission.job, submission.id) : null,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
  };
}
function configuration(
  name: string,
  language: FontLanguage,
  sortOrder: number,
): FontConfigurationDto {
  return {
    name,
    designLanguage: language,
    sortOrder,
    specimenText: FONT_LANGUAGE_SPECIMENS[language],
    author: '',
    sourceUrl: '',
    licenseName: '',
    licenseText: '',
    rights: { redistribution: false, conversion: false, subsetting: false },
  };
}
function matchingSource(
  job: TextFontBuildJob,
  sha256: string,
  bytes: number,
  format: string,
  submissionId: string,
) {
  if (job.sourceSha256 !== sha256 || job.sourceBytes !== bytes || job.sourceFormat !== format)
    conflict();
  return fontJobDto(job, submissionId);
}

@Injectable()
export class FontSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 持有字体排他锁；达到旧配置上限时保持语言组相对顺序并原子发布新目录。 */
  private async nextSortOrder(
    tx: Prisma.TransactionClient,
    language: FontLanguage,
    actor: FontActor,
  ) {
    const [row] = await tx.$queryRaw<{ maximum: number | null; total: number }[]>`
      SELECT max((f.configuration->>'sortOrder')::integer) AS maximum, count(*)::integer AS total
      FROM text_font_families f LEFT JOIN text_font_versions v ON v.id = f.last_published_version_id
      WHERE coalesce(v.configuration->>'designLanguage', f.configuration->>'designLanguage') = ${language}`;
    const next = (row?.maximum ?? -1) + 1;
    if (next <= FONT_SORT_ORDER_LIMIT) return next;
    if (row.total > FONT_SORT_ORDER_LIMIT) fontConflict();
    const [result] = await tx.$queryRaw<{ changed: number }[]>`
      WITH ordered AS (
        SELECT f.id, (row_number() OVER (
          ORDER BY (f.configuration->>'sortOrder')::integer, f.id
        ) - 1)::integer AS position
        FROM text_font_families f LEFT JOIN text_font_versions v ON v.id = f.last_published_version_id
        WHERE coalesce(v.configuration->>'designLanguage', f.configuration->>'designLanguage') = ${language}
      ), changed AS (
        UPDATE text_font_families f SET
          configuration = jsonb_set(f.configuration, '{sortOrder}', to_jsonb(ordered.position)),
          revision = f.revision + 1, updated_at = CURRENT_TIMESTAMP
        FROM ordered WHERE f.id = ordered.id
          AND (f.configuration->>'sortOrder')::integer <> ordered.position
        RETURNING f.id
      ) SELECT count(*)::integer AS changed FROM changed`;
    const revision = await publishFontCatalog(tx);
    await this.audit.record(
      {
        ...actor,
        action: 'TEXT_FONT_DRAFT_UPDATED',
        targetType: 'TEXT_FONT',
        targetId: 'font-catalog',
        metadata: {
          operation: 'normalize-sort-order',
          language,
          familyCount: result.changed,
          revision,
        },
      },
      tx,
    );
    return row.total;
  }

  async create(dto: CreateFontSubmissionDto, actor: FontActor): Promise<FontSubmissionDto> {
    this.storage.requireConfigured();
    const requestSha256 = fontSha(
      canonicalFontJson({
        name: dto.name,
        language: dto.language,
        familyId: dto.familyId ?? null,
        expectedFamilyRevision: dto.expectedFamilyRevision ?? null,
      }),
    );
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const previous = await tx.textFontSubmission.findUnique({
        where: { id: dto.submissionId },
        include,
      });
      if (previous) {
        if (previous.actorId !== actor.actorId || previous.requestSha256 !== requestSha256)
          conflict();
        return response(previous);
      }
      let family;
      if (dto.familyId) {
        const existing = await tx.textFontFamily.findUnique({ where: { id: dto.familyId } });
        if (!existing) throw notFound();
        if (existing.revision !== dto.expectedFamilyRevision) fontConflict();
        const saved = fontConfiguration(existing.configuration);
        family = await tx.textFontFamily.update({
          where: { id: existing.id },
          data: {
            configuration: fontJson({
              ...saved,
              name: dto.name,
              designLanguage: dto.language,
              specimenText: existing.specimenAutomatic
                ? FONT_LANGUAGE_SPECIMENS[dto.language]
                : saved.specimenText,
            }),
            revision: { increment: 1 },
          },
        });
      } else {
        const sortOrder = await this.nextSortOrder(tx, dto.language, actor);
        family = await tx.textFontFamily.create({
          data: {
            id: newFontId('tff'),
            specimenAutomatic: true,
            configuration: fontJson(configuration(dto.name, dto.language, sortOrder)),
          },
        });
      }
      const submission = await tx.textFontSubmission.create({
        data: {
          id: dto.submissionId,
          familyId: family.id,
          actorId: actor.actorId,
          requestSha256,
          configuration: fontJson(family.configuration),
        },
        include,
      });
      await bumpFontListing(tx);
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_DRAFT_UPDATED',
          targetType: 'TEXT_FONT',
          targetId: family.id,
          metadata: { revision: family.revision, submissionId: submission.id },
        },
        tx,
      );
      return response(submission);
    });
  }

  async get(submissionId: string): Promise<FontSubmissionDto> {
    this.storage.requireConfigured();
    const submission = await this.prisma.textFontSubmission.findUnique({
      where: { id: submissionId },
      include,
    });
    if (!submission) throw notFound();
    return response(submission);
  }

  async upload(familyId: string, query: FontSourceQueryDto, source: Buffer, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(familyId, 'tff');
    if (!Buffer.isBuffer(source) || !source.length || source.length > FONT_SOURCE_MAX_BYTES)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择不超过 64 MiB 的单个字体文件');
    const sourceSha256 = fontSha(source);
    const existing = await this.prisma.textFontSubmission.findUnique({
      where: { id: query.submissionId! },
      include,
    });
    if (!existing || existing.familyId !== familyId) throw notFound();
    if (existing.job)
      return matchingSource(existing.job, sourceSha256, source.length, query.format, existing.id);
    if (existing.family.revision !== query.expectedFamilyRevision) fontConflict();
    const stored = await this.storage.putSource(source, query.format);
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const submission = await tx.textFontSubmission.findUniqueOrThrow({
        where: { id: existing.id },
        include,
      });
      if (submission.job)
        return matchingSource(
          submission.job,
          sourceSha256,
          source.length,
          query.format,
          submission.id,
        );
      if (submission.family.revision !== query.expectedFamilyRevision) fontConflict();
      const authorization = {
        actorId: actor.actorId,
        confirmedAt: new Date().toISOString(),
        sourceSha256,
        ruleVersion: FONT_UPLOAD_RULE_VERSION,
      };
      const job = await tx.textFontBuildJob.create({
        data: {
          id: newFontId('tfj'),
          familyId,
          configuration: fontJson(submission.configuration),
          parametersVersion: 2,
          uploadAuthorization: authorization,
          sourceSha256,
          sourceBytes: stored.bytes,
          sourceKey: stored.key,
          sourceFormat: query.format,
        },
      });
      await tx.textFontSubmission.update({ where: { id: submission.id }, data: { jobId: job.id } });
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_SOURCE_UPLOADED',
          targetType: 'TEXT_FONT',
          targetId: job.id,
          metadata: {
            familyId,
            sourceSha256,
            sourceBytes: stored.bytes,
            ruleVersion: FONT_UPLOAD_RULE_VERSION,
          },
        },
        tx,
      );
      return fontJobDto(job, submission.id);
    });
  }

  async process(submissionId: string, requestId: string, actor: FontActor) {
    this.storage.requireConfigured();
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const submission = await tx.textFontSubmission.findUnique({
        where: { id: submissionId },
        include: { job: true },
      });
      if (!submission) throw notFound();
      if (!submission.job) fontConflict();
      const previous = await tx.textFontProcessRequest.findUnique({
        where: { submissionId_requestId: { submissionId, requestId } },
      });
      if (previous) return fontJobDto(submission.job, submission.id);
      const job = await requestFontBuild(tx, submission.job, actor, this.outbox, this.audit);
      await tx.textFontProcessRequest.create({
        data: { submissionId, requestId, attempt: job.attempt },
      });
      return fontJobDto(job, submission.id);
    });
  }
}
