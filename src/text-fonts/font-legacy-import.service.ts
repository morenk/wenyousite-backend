import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { FontAssetDto } from './dto/font-public.dto';
import {
  fontJson,
  bumpFontListing,
  fontSha,
  lockFontActor,
  lockFontState,
  newFontId,
  requireFontRights,
} from './font-domain';
import {
  LegacyFont,
  legacyBuildKey,
  legacyCoverage,
  loadLegacyBundle,
  readLegacyAsset,
} from './font-legacy-bundle';
import { FONT_LEGACY_IMPORT } from './font-legacy-map';
import { fontManifestAssets, validateFontManifest } from './font-manifest';
import { publishFontCatalog } from './font-catalog-publisher';
import { FontSandboxService } from './font-sandbox.service';
import { FontStorageService } from './font-storage.service';
import { FontWorkDirectoryService } from './font-work-directory.service';

type Prepared = {
  font: LegacyFont;
  configuration: FontConfigurationDto;
  artifact: Prisma.TextFontArtifactUncheckedCreateInput;
};
const descriptor = ({ sha256, bytes, format }: FontAssetDto): FontAssetDto => ({
  sha256,
  bytes,
  format,
});

/** 离线维护入口；API 不提供历史包或远程地址导入。所有解析仍经过字体沙箱。 */
@Injectable()
export class FontLegacyImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
    private readonly sandbox: FontSandboxService,
    private readonly work: FontWorkDirectoryService,
    private readonly audit: AuditService,
  ) {}

  async import(bundleRoot: string, rawRoot: string, actorId: string) {
    const role = await this.prisma.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`;
    if (role[0]?.role !== 'wenyousite_app')
      throw new Error('font_import_application_role_required');
    await this.requireActor(this.prisma, actorId);
    const bundle = await loadLegacyBundle();
    const prepared: Prepared[] = [];
    for (const font of bundle.fonts) {
      const mapping = FONT_LEGACY_IMPORT.fonts.find((row) => row.legacyId === font.id)!;
      const existing = await this.prisma.textFontVersion.findUnique({
        where: { id: mapping.versionId },
        include: { artifact: true, family: true },
      });
      if (existing) {
        if (
          existing.familyId !== mapping.familyId ||
          existing.family.legacyId !== font.id ||
          existing.artifactKey !== legacyBuildKey(font) ||
          !existing.publishedAt
        )
          throw new Error('font_import_existing_identity');
        await this.storage.verifyAssets(existing.artifact.assets as unknown as FontAssetDto[]);
        continue;
      }
      prepared.push(await this.prepare(font, bundleRoot, rawRoot, bundle.toolchain));
    }
    // 对象先写入私有存储并复验，最后一次事务提交全部版本、目录及审计，不出现半发布目录。
    return this.prisma.$transaction(
      async (tx) => {
        await lockFontActor(tx, actorId);
        await this.requireActor(tx, actorId);
        await lockFontState(tx);
        let imported = 0;
        for (const item of prepared) {
          const mapping = FONT_LEGACY_IMPORT.fonts.find((row) => row.legacyId === item.font.id)!;
          const existing = await tx.textFontVersion.findUnique({
            where: { id: mapping.versionId },
          });
          if (existing) {
            if (
              existing.familyId !== mapping.familyId ||
              existing.artifactKey !== item.artifact.buildKey ||
              !existing.publishedAt
            )
              throw new Error('font_import_existing_identity');
            continue;
          }
          await tx.textFontFamily.create({
            data: {
              id: mapping.familyId,
              legacyId: mapping.legacyId,
              configuration: fontJson(item.configuration),
              nextVersion: 2,
            },
          });
          const artifact = await tx.textFontArtifact.upsert({
            where: { buildKey: item.artifact.buildKey },
            create: item.artifact,
            update: {},
          });
          if (artifact.manifestSha !== item.artifact.manifestSha)
            throw new Error('font_import_artifact_identity');
          await tx.textFontVersion.create({
            data: {
              id: mapping.versionId,
              familyId: mapping.familyId,
              versionNumber: 1,
              artifactKey: artifact.buildKey,
              reuseKey: artifact.buildKey,
              configuration: fontJson(item.configuration),
              publishedAt: new Date(),
            },
          });
          await tx.textFontFamily.update({
            where: { id: mapping.familyId },
            data: {
              currentVersionId: mapping.versionId,
              lastPublishedVersionId: mapping.versionId,
            },
          });
          await this.audit.record(
            {
              actorId,
              action: 'TEXT_FONT_IMPORTED',
              targetType: 'TEXT_FONT',
              targetId: mapping.versionId,
              metadata: {
                legacyId: mapping.legacyId,
                sourceManifestSha256: FONT_LEGACY_IMPORT.sourceManifestSha256,
                manifestSha256: artifact.manifestSha,
                buildKey: artifact.buildKey,
              },
            },
            tx,
          );
          imported++;
        }
        const catalogRevision = imported
          ? await publishFontCatalog(tx)
          : (await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } })).revision;
        if (imported) await bumpFontListing(tx);
        return { imported, retained: bundle.fonts.length - imported, catalogRevision };
      },
      { timeout: 30000 },
    );
  }

  private async requireActor(tx: Prisma.TransactionClient, id: string) {
    const actor = await tx.user.findFirst({
      where: { id, deletedAt: null, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    });
    if (!actor) throw new Error('font_import_admin_required');
  }

  private async prepare(
    font: LegacyFont,
    bundleRoot: string,
    rawRoot: string,
    legacyToolchain: Record<string, string>,
  ): Promise<Prepared> {
    const sources = JSON.parse(
      await readFile(join(__dirname, '../../contracts/thread-font-sources-v1.json'), 'utf8'),
    ) as {
      fonts: Array<{
        id: string;
        bytes: number;
        fontBytes?: number;
        officialPage?: string;
        url: string;
        instance?: Record<string, number>;
      }>;
    };
    const source = sources.fonts.find((row) => row.id === font.id)!;
    let raw: Buffer | undefined;
    let format: 'ttf' | 'otf' = 'ttf';
    for (const candidate of ['ttf', 'otf'] as const) {
      const path = join(rawRoot, `${font.fontSha256}.${candidate}`);
      try {
        await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new Error('font_import_source_identity');
      }
      raw = await this.storage.readChecked(path, source.fontBytes ?? source.bytes);
      format = candidate;
      break;
    }
    if (
      !raw ||
      fontSha(raw) !== font.fontSha256 ||
      raw.subarray(0, 4).toString('hex') !== (format === 'ttf' ? '00010000' : '4f54544f')
    )
      throw new Error('font_import_source_identity');
    const storedSource = await this.storage.putSource(raw, format);
    const notices: FontAssetDto[] = [];
    let author = '',
      licenseText = '';
    for (const notice of font.notices) {
      const bytes = await readLegacyAsset(this.storage, bundleRoot, notice);
      if (notice.kind === 'license') licenseText = bytes.toString('utf8');
      if (notice.kind === 'attribution') {
        const attribution = JSON.parse(bytes.toString('utf8')) as {
          designer: string[];
          manufacturer: string[];
          copyright: string[];
        };
        author =
          [...attribution.designer, ...attribution.manufacturer, ...attribution.copyright].find(
            (text) => !!text.trim(),
          ) ?? '';
      }
      // 保留原始授权正文及其 SHA，不把治理补充材料冒充压缩包原始许可证。
      notices.push(
        await this.storage.putAsset(
          Buffer.from(
            JSON.stringify({
              kind: notice.kind,
              originalSha256: notice.sha256,
              originalPath: notice.path,
              originalBase64: bytes.toString('base64'),
              text: bytes.toString('utf8'),
            }),
          ),
          'json',
        ),
      );
    }
    const configuration: FontConfigurationDto = {
      name: font.name,
      designLanguage: font.designLanguage,
      sortOrder: FONT_LEGACY_IMPORT.fonts.findIndex((row) => row.legacyId === font.id),
      author: author.slice(0, 200),
      sourceUrl: source.officialPage || source.url,
      licenseName: font.license,
      licenseText,
      specimenText: font.designLanguage === 'en' ? 'Wenyou Aa 0123' : '温油文字 Aa 0123',
      rights: { redistribution: true, conversion: true, subsetting: true },
    };
    requireFontRights(configuration);
    const shards = [];
    for (const shard of font.shards) {
      for (const asset of [shard.web, shard.mobile]) {
        const saved = await this.storage.putAsset(
          await readLegacyAsset(this.storage, bundleRoot, asset),
          asset.format,
        );
        if (JSON.stringify(saved) !== JSON.stringify(descriptor(asset)))
          throw new Error('font_import_asset_identity');
      }
      shards.push({ ...shard, web: descriptor(shard.web), mobile: descriptor(shard.mobile) });
    }
    const specimen = await this.preview(font, configuration.specimenText);
    const buildKey = legacyBuildKey(font);
    const manifest = validateFontManifest({
      manifestVersion: 2,
      buildKey,
      sourceSha256: font.fontSha256,
      baseWeight: 400,
      baseStyle: 'normal',
      coverage: legacyCoverage(font),
      shards,
      notices,
      specimen,
    });
    const savedManifest = await this.storage.putAsset(
      Buffer.from(JSON.stringify(manifest)),
      'json',
    );
    const assets = [...fontManifestAssets(manifest), savedManifest];
    await this.storage.verifyAssets(assets);
    return {
      font,
      configuration,
      artifact: {
        buildKey,
        sourceSha256: font.fontSha256,
        toolchain: fontJson({
          kind: 'preserved-v1',
          legacyToolchain,
          sourceKey: storedSource.key,
          sourceBytes: storedSource.bytes,
          sourceManifestSha256: FONT_LEGACY_IMPORT.sourceManifestSha256,
          preview: 'Pillow-13.0.0',
        }),
        manifest: fontJson(manifest),
        assets: fontJson(assets),
        manifestSha: savedManifest.sha256,
        manifestSize: savedManifest.bytes,
        specimenSha: specimen.sha256,
        specimenSize: specimen.bytes,
      },
    };
  }

  private async preview(font: LegacyFont, specimenText: string) {
    const ticket = await this.work.create(
      newFontId('tfj'),
      1,
      randomBytes(16).toString('hex'),
      'import',
    );
    try {
      const input = join(ticket.root, 'input'),
        output = join(ticket.root, 'output');
      await mkdir(input, { mode: 0o700 });
      await mkdir(output, { mode: 0o700 });
      const asset = font.shards.find((shard) => shard.id === 'core')!.mobile;
      await writeFile(join(input, 'source'), await this.storage.readAsset(asset), {
        flag: 'wx',
        mode: 0o400,
      });
      await writeFile(
        join(input, 'parameters.json'),
        JSON.stringify({ sourceSha256: asset.sha256, specimenText }),
        { flag: 'wx', mode: 0o400 },
      );
      await this.sandbox.run(input, output, {
        script: join(__dirname, '../../scripts/fonts/dynamic/legacy-preview.py'),
      });
      const path = join(output, 'specimen.png');
      const stat = await lstat(path);
      return await this.storage.putAsset(await this.storage.readChecked(path, stat.size), 'png');
    } finally {
      await this.work.remove(ticket, true);
    }
  }
}
