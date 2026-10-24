import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from '../moderation/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import {
  FontConfigurationDto,
  FontEnabledDto,
  FontPublishDto,
  FontSourceQueryDto,
  FontWithdrawDto,
  UpdateFontConfigurationDto,
} from './dto/font-admin.dto';
import { FontAssetDto } from './dto/font-public.dto';
import {
  FontActor,
  fontConfiguration,
  fontConflict,
  fontFamilyDto,
  fontIdentity,
  fontJobDto,
  fontJson,
  lockFontState,
  lockFontActor,
  newFontId,
  bumpFontListing,
} from './font-domain';
import { FontStorageService } from './font-storage.service';
import { FontQueryService } from './font-query.service';
import { publishFontCatalog } from './font-catalog-publisher';
import { requestFontBuild } from './font-build-request';
import { requireFontAuthorization } from './font-authorization';

function configuration(dto: FontConfigurationDto): Prisma.InputJsonValue {
  const {
    name,
    designLanguage,
    sortOrder,
    author,
    sourceUrl,
    licenseName,
    licenseText,
    specimenText,
    rights,
  } = dto;
  return fontJson({
    name,
    designLanguage,
    sortOrder,
    author,
    sourceUrl,
    licenseName,
    licenseText,
    specimenText,
    rights,
  });
}

@Injectable()
export class FontAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly queries: FontQueryService,
  ) {}

  async create(dto: FontConfigurationDto, actor: FontActor) {
    this.storage.requireConfigured();
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const family = await tx.textFontFamily.create({
        data: { id: newFontId('tff'), configuration: configuration(dto) },
      });
      await bumpFontListing(tx);
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_DRAFT_UPDATED',
          targetType: 'TEXT_FONT',
          targetId: family.id,
          metadata: { revision: family.revision },
        },
        tx,
      );
      return fontFamilyDto(family, head.revision);
    });
  }

  async update(familyId: string, dto: UpdateFontConfigurationDto, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(familyId, 'tff');
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const previous = await tx.textFontFamily.findUnique({ where: { id: familyId } });
      if (!previous) throw notFound();
      if (previous.revision !== dto.expectedFamilyRevision) fontConflict();
      const family = await tx.textFontFamily.update({
        where: { id: familyId },
        data: {
          configuration: configuration(dto),
          specimenAutomatic:
            previous.specimenAutomatic === true &&
            dto.specimenText === fontConfiguration(previous.configuration).specimenText,
          revision: { increment: 1 },
        },
      });
      await bumpFontListing(tx);
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_DRAFT_UPDATED',
          targetType: 'TEXT_FONT',
          targetId: family.id,
          metadata: { revision: family.revision },
        },
        tx,
      );
      return fontFamilyDto(family, head.revision);
    });
  }

  async upload(familyId: string, query: FontSourceQueryDto, source: Buffer, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(familyId, 'tff');
    const previous = await this.prisma.textFontFamily.findUnique({ where: { id: familyId } });
    if (!previous) throw notFound();
    if (previous.revision !== query.expectedFamilyRevision) fontConflict();
    const stored = await this.storage.putSource(source, query.format);
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const family = await tx.textFontFamily.findUniqueOrThrow({ where: { id: familyId } });
      if (family.revision !== query.expectedFamilyRevision) fontConflict();
      const job = await tx.textFontBuildJob.create({
        data: {
          id: newFontId('tfj'),
          familyId,
          configuration: fontJson(family.configuration),
          sourceSha256: stored.sha256,
          sourceBytes: stored.bytes,
          sourceFormat: query.format,
          sourceKey: stored.key,
        },
      });
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_SOURCE_UPLOADED',
          targetType: 'TEXT_FONT',
          targetId: job.id,
          metadata: { familyId, sourceSha256: stored.sha256, sourceBytes: stored.bytes },
        },
        tx,
      );
      return fontJobDto(job);
    });
  }

  async process(jobId: string, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(jobId, 'tfj');
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const previous = await tx.textFontBuildJob.findUnique({ where: { id: jobId } });
      if (!previous) throw notFound();
      if (previous.parametersVersion === 2)
        throw new BusinessException(
          ErrorCode.TEXT_FONT_SUBMISSION_CONFLICT,
          '请通过简化提交记录启动或重试处理',
          HttpStatus.CONFLICT,
        );
      return fontJobDto(await requestFontBuild(tx, previous, actor, this.outbox, this.audit));
    });
  }

  async publish(familyId: string, dto: FontPublishDto, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(familyId, 'tff');
    const candidate = await this.prisma.textFontVersion.findFirst({
      where: { id: dto.versionId, familyId, withdrawnAt: null },
      include: { artifact: true },
    });
    if (!candidate) throw notFound();
    requireFontAuthorization(
      fontConfiguration(candidate.configuration),
      candidate.artifact.sourceSha256,
      candidate.parametersVersion,
      candidate.uploadAuthorization,
    );
    try {
      await this.storage.verifyAssets(candidate.artifact.assets as unknown as FontAssetDto[]);
    } catch {
      throw new BusinessException(
        ErrorCode.TEXT_FONT_UNAVAILABLE,
        '字体资源暂不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const [family, head, version] = await Promise.all([
        tx.textFontFamily.findUnique({ where: { id: familyId } }),
        tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } }),
        tx.textFontVersion.findUnique({ where: { id: dto.versionId } }),
      ]);
      if (!family || !version) throw notFound();
      if (
        family.revision !== dto.expectedFamilyRevision ||
        head.revision !== dto.expectedCatalogRevision ||
        version.familyId !== familyId ||
        version.withdrawnAt ||
        version.artifactKey !== candidate.artifactKey
      )
        fontConflict();
      if (!version.publishedAt)
        await tx.textFontVersion.update({
          where: { id: version.id },
          data: { publishedAt: new Date() },
        });
      const updated = await tx.textFontFamily.update({
        where: { id: familyId },
        data: {
          currentVersionId: version.id,
          lastPublishedVersionId: version.id,
          revision: { increment: 1 },
        },
      });
      const revision = await publishFontCatalog(tx);
      await bumpFontListing(tx);
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_PUBLISHED',
          targetType: 'TEXT_FONT',
          targetId: version.id,
          metadata: { familyId, revision },
        },
        tx,
      );
      return fontFamilyDto(updated, revision);
    });
  }

  async enabled(familyId: string, dto: FontEnabledDto, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(familyId, 'tff');
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const family = await tx.textFontFamily.findUnique({ where: { id: familyId } });
      if (!family) throw notFound();
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      if (
        family.revision !== dto.expectedFamilyRevision ||
        head.revision !== dto.expectedCatalogRevision
      )
        fontConflict();
      const updated = await tx.textFontFamily.update({
        where: { id: familyId },
        data: { enabled: dto.enabled, revision: { increment: 1 } },
      });
      const revision = await publishFontCatalog(tx);
      await bumpFontListing(tx);
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_ENABLED_UPDATED',
          targetType: 'TEXT_FONT',
          targetId: familyId,
          metadata: { enabled: dto.enabled, revision },
        },
        tx,
      );
      return fontFamilyDto(updated, revision);
    });
  }

  async withdraw(versionId: string, dto: FontWithdrawDto, actor: FontActor) {
    this.storage.requireConfigured();
    fontIdentity(versionId, 'tfv');
    await this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const version = await tx.textFontVersion.findUnique({ where: { id: versionId } });
      if (!version) throw notFound();
      if (version.withdrawnAt) return;
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      if (head.revision !== dto.expectedCatalogRevision) fontConflict();
      await tx.textFontVersion.update({
        where: { id: versionId },
        data: { withdrawnAt: new Date(), reuseKey: null },
      });
      await tx.textFontFamily.updateMany({
        where: { id: version.familyId, currentVersionId: versionId },
        data: { currentVersionId: null, revision: { increment: 1 } },
      });
      const revision = await publishFontCatalog(tx);
      await bumpFontListing(tx);
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_WITHDRAWN',
          targetType: 'TEXT_FONT',
          targetId: versionId,
          reason: dto.reason,
          metadata: { revision },
        },
        tx,
      );
    });
    return this.queries.version(versionId, true);
  }
}
