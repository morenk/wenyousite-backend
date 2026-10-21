import { Prisma } from '@prisma/client';
import { FontCatalogEntryDto } from './dto/font-public.dto';
import { fontConfiguration, fontJson, newFontId } from './font-domain';
import { fontAssetBasePath } from './font-query.service';

/** 调用者已持有字体排他事务锁；快照只引用已发布且可选的当前版本。 */
export async function publishFontCatalog(tx: Prisma.TransactionClient) {
  const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
  const families = await tx.textFontFamily.findMany({
    where: { enabled: true, currentVersionId: { not: null } },
    include: {
      currentVersion: {
        include: { artifact: { select: { specimenSha: true, specimenSize: true } } },
      },
    },
  });
  const entries: FontCatalogEntryDto[] = [];
  for (const family of families) {
    const version = family.currentVersion;
    if (!version || !version.publishedAt || version.withdrawnAt) continue;
    const config = fontConfiguration(version.configuration);
    entries.push({
      familyId: family.id,
      versionId: version.id,
      name: config.name,
      designLanguage: config.designLanguage,
      sortOrder: fontConfiguration(family.configuration).sortOrder,
      selectable: true,
      pasteAllowed: true,
      renderAllowed: true,
      assetBasePath: fontAssetBasePath(version.id),
      specimen: {
        sha256: version.artifact.specimenSha,
        bytes: version.artifact.specimenSize,
        format: 'png',
      },
    });
  }
  entries.sort((a, b) => a.sortOrder - b.sortOrder || a.familyId.localeCompare(b.familyId));
  const revision = head.revision + 1;
  const release = await tx.textFontCatalogRelease.create({
    data: { id: newFontId('tfc'), revision, entries: fontJson(entries) },
  });
  await tx.textFontCatalogHead.update({
    where: { id: 1 },
    data: { revision, releaseId: release.id },
  });
  return revision;
}
