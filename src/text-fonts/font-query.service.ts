import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { FontAdminListQueryDto } from './dto/font-admin.dto';
import {
  FontAssetDto,
  FontCatalogEntryDto,
  FontCatalogQueryDto,
  FontVersionDescriptorDto,
} from './dto/font-public.dto';
import { fontCatalogPage } from './font-catalog-page';
import {
  fontConfiguration,
  fontFamilyDto,
  fontIdentity,
  fontJobDto,
  lockFontState,
} from './font-domain';
import { FontStorageService } from './font-storage.service';
import { fontVersionState } from './font-version-state';

const descriptorInclude = {
  family: { select: { enabled: true, currentVersionId: true } },
  artifact: {
    select: { manifestSha: true, manifestSize: true, specimenSha: true, specimenSize: true },
  },
} satisfies Prisma.TextFontVersionInclude;
type Version = Prisma.TextFontVersionGetPayload<{ include: typeof descriptorInclude }>;
export const fontAssetBasePath = (versionId: string, preview = false) =>
  `/api/v1/${preview ? 'admin/text-fonts' : 'meta/text-fonts/v2'}/versions/${versionId}/assets/`;

export function fontDescriptor(
  version: Version,
  revision: number,
  preview = false,
): FontVersionDescriptorDto {
  const config = fontConfiguration(version.configuration);
  const state = fontVersionState(
    !!version.publishedAt,
    version.family.enabled,
    version.family.currentVersionId === version.id,
    !!version.withdrawnAt,
  );
  const status = version.withdrawnAt
    ? 'withdrawn'
    : !version.publishedAt
      ? 'preview'
      : !version.family.enabled
        ? 'disabled'
        : 'published';
  const renderAllowed = !version.withdrawnAt && (preview || state.renderAllowed);
  return {
    fontVersion: 2,
    versionId: version.id,
    familyId: version.familyId,
    versionNumber: version.versionNumber,
    name: config.name,
    designLanguage: config.designLanguage,
    revision,
    status,
    ...state,
    renderAllowed,
    assetBasePath: renderAllowed ? fontAssetBasePath(version.id, preview) : null,
    manifest: renderAllowed
      ? {
          sha256: version.artifact.manifestSha,
          bytes: version.artifact.manifestSize,
          format: 'json',
        }
      : null,
    specimen: renderAllowed
      ? {
          sha256: version.artifact.specimenSha,
          bytes: version.artifact.specimenSize,
          format: 'png',
        }
      : null,
  };
}

@Injectable()
export class FontQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
  ) {}

  async catalog(query: FontCatalogQueryDto) {
    this.storage.requireConfigured();
    const head = await this.prisma.textFontCatalogHead.findUniqueOrThrow({
      where: { id: 1 },
      include: { release: true },
    });
    if (!head.release) throw new Error('font_catalog_uninitialized');
    return fontCatalogPage(
      head.release.id,
      head.revision,
      head.release.entries as unknown as FontCatalogEntryDto[],
      query,
    );
  }

  async version(versionId: string, preview = false) {
    this.storage.requireConfigured();
    fontIdentity(versionId, 'tfv');
    return this.prisma.$transaction(async (tx) => {
      await lockFontState(tx, true);
      const version = await tx.textFontVersion.findUnique({
        where: { id: versionId },
        include: descriptorInclude,
      });
      if (!version || (!preview && !version.publishedAt)) throw notFound();
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      return fontDescriptor(version, head.revision, preview);
    });
  }

  async asset(versionId: string, name: string, preview = false) {
    this.storage.requireConfigured();
    fontIdentity(versionId, 'tfv');
    if (!/^[a-f0-9]{64}\.(?:woff2|ttf|otf|json|png)$/u.test(name)) throw notFound();
    const version = await this.prisma.textFontVersion.findUnique({
      where: { id: versionId },
      include: { artifact: { select: { assets: true } } },
    });
    const assertReadable = (
      current: { publishedAt: Date | null; withdrawnAt: Date | null } | null,
    ) => {
      if (!current || (!preview && !current.publishedAt)) throw notFound();
      if (current.withdrawnAt)
        throw new BusinessException(ErrorCode.TEXT_FONT_WITHDRAWN, '该字体已撤回', HttpStatus.GONE);
    };
    assertReadable(version);
    const assets = version!.artifact.assets as unknown as FontAssetDto[];
    const asset = assets.find((item) => `${item.sha256}.${item.format}` === name);
    if (!asset) throw notFound();
    let bytes: Buffer;
    try {
      // 远端读取不占用数据库事务/字体状态锁；读完再检查撤回，避免慢 S3 阻塞撤回。
      bytes = await this.storage.readAsset(asset);
    } catch {
      throw new BusinessException(
        ErrorCode.TEXT_FONT_UNAVAILABLE,
        '字体资源暂不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await lockFontState(tx, true);
      const current = await tx.textFontVersion.findUnique({ where: { id: versionId } });
      assertReadable(current);
      if (current!.artifactKey !== version!.artifactKey) throw notFound();
    });
    const contentType = {
      json: 'application/json; charset=utf-8',
      png: 'image/png',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
    }[asset.format];
    return { bytes, contentType, sha256: asset.sha256 };
  }

  async list(query: FontAdminListQueryDto) {
    this.storage.requireConfigured();
    return this.prisma.$transaction(async (tx) => {
      await lockFontState(tx, true);
      const families = await tx.textFontFamily.findMany({
        where: query.after ? { id: { gt: query.after } } : {},
        orderBy: { id: 'asc' },
        take: query.limit + 1,
      });
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      const items = families.slice(0, query.limit);
      return {
        items: items.map((family) => fontFamilyDto(family, head.revision)),
        nextAfter: families.length > query.limit ? items.at(-1)!.id : null,
      };
    });
  }

  async detail(familyId: string) {
    this.storage.requireConfigured();
    fontIdentity(familyId, 'tff');
    return this.prisma.$transaction(async (tx) => {
      await lockFontState(tx, true);
      const family = await tx.textFontFamily.findUnique({
        where: { id: familyId },
        include: {
          jobs: { orderBy: { createdAt: 'desc' } },
          versions: { orderBy: { versionNumber: 'desc' }, select: { id: true } },
        },
      });
      if (!family) throw notFound();
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      return {
        ...fontFamilyDto(family, head.revision),
        jobs: family.jobs.map(fontJobDto),
        versionIds: family.versions.map((version) => version.id),
      };
    });
  }

  async job(jobId: string) {
    this.storage.requireConfigured();
    fontIdentity(jobId, 'tfj');
    const job = await this.prisma.textFontBuildJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound();
    return fontJobDto(job);
  }
}
