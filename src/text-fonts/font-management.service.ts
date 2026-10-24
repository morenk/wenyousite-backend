import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import {
  FontManagementItemDto,
  FontManagementPageDto,
  FontManagementQueryDto,
  FontReorderResultDto,
  ReorderFontsDto,
} from './dto/font-management.dto';
import { canonicalFontJson } from './font-build-identity';
import {
  FontActor,
  bumpFontListing,
  fontConfiguration,
  fontConflict,
  fontJobDto,
  fontJson,
  fontSha,
  lockFontActor,
  lockFontState,
} from './font-domain';
import { publishFontCatalog } from './font-catalog-publisher';
import { FontStorageService } from './font-storage.service';

type Row = Omit<
  FontManagementItemDto,
  'createdAt' | 'updatedAt' | 'publishedAt' | 'withdrawnAt' | 'latestJob' | 'latestSubmissionId'
> & {
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
};
const projection = Prisma.sql`
  SELECT f.id AS "familyId", coalesce(v.configuration->>'name', f.configuration->>'name') AS name,
    coalesce(v.configuration->>'designLanguage', f.configuration->>'designLanguage') AS language,
    (f.configuration->>'sortOrder')::integer AS "sortOrder", f.revision, f.enabled,
    CASE WHEN v.withdrawn_at IS NOT NULL THEN 'withdrawn' WHEN v.id IS NULL THEN 'draft'
      WHEN f.enabled THEN 'enabled' ELSE 'disabled' END AS status,
    f.current_version_id AS "currentVersionId", f.last_published_version_id AS "lastPublishedVersionId",
    f.created_at AS "createdAt", f.updated_at AS "updatedAt", v.published_at AS "publishedAt", v.withdrawn_at AS "withdrawnAt"
  FROM text_font_families f LEFT JOIN text_font_versions v ON v.id = f.last_published_version_id`;

/** 只读取紧凑管理投影；统一 Unicode 匹配/字节排序，不依赖数据库安装的 locale。 */
export function selectFontManagementPage<T extends Row>(
  candidates: T[],
  query: FontManagementQueryDto,
  offset: number,
) {
  const fold = (name: string) => name.normalize('NFC').toLowerCase();
  const q = fold((query.q ?? '').trim());
  const sort = query.sort ?? 'createdAt';
  const direction = query.direction === 'asc' ? 1 : -1;
  const matching = candidates.filter(
    (row) =>
      (!q || fold(row.name).includes(q)) &&
      (!query.language || row.language === query.language) &&
      (!query.status || row.status === query.status),
  );
  matching.sort((a, b) => {
    const primary =
      sort === 'name'
        ? Buffer.compare(Buffer.from(fold(a.name)), Buffer.from(fold(b.name)))
        : sort === 'sortOrder'
          ? a.sortOrder - b.sortOrder
          : a[sort].getTime() - b[sort].getTime();
    return (
      primary * direction || (a.familyId < b.familyId ? -1 : a.familyId === b.familyId ? 0 : 1)
    );
  });
  return { items: matching.slice(offset, offset + 20), total: matching.length };
}

export function fontManagementOffset(
  cursor: string | undefined,
  revision: number,
  filter: string,
): number {
  if (!cursor) return 0;
  let parsed: { version?: unknown; revision?: unknown; filter?: unknown; offset?: unknown };
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error();
    parsed = JSON.parse(bytes.toString('utf8'));
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.revision) ||
      typeof parsed.filter !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(parsed.filter) ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset as number) < 0
    )
      throw new Error();
  } catch {
    throw new BadRequestException('字体列表游标无效');
  }
  if (parsed.revision !== revision || parsed.filter !== filter)
    throw new BusinessException(
      ErrorCode.TEXT_FONT_LIST_CHANGED,
      '列表已变化，请从第一页重新加载',
      409,
    );
  return parsed.offset as number;
}

@Injectable()
export class FontManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
    private readonly audit: AuditService,
  ) {}

  async list(query: FontManagementQueryDto): Promise<FontManagementPageDto> {
    this.storage.requireConfigured();
    const normalized = {
      q: (query.q ?? '').trim().normalize('NFC').toLowerCase(),
      language: query.language ?? null,
      status: query.status ?? null,
      sort: query.sort ?? 'createdAt',
      direction: query.direction ?? 'desc',
    };
    const filter = fontSha(canonicalFontJson(normalized));
    return this.prisma.$transaction(async (tx) => {
      await lockFontState(tx, true);
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      const offset = fontManagementOffset(query.cursor, head.listingRevision, filter);
      const candidates = await tx.$queryRaw<Row[]>(projection);
      const { items: rows, total } = selectFontManagementPage(candidates, query, offset);
      const state = await tx.textFontFamily.findMany({
        where: { id: { in: rows.map((row) => row.familyId) } },
        select: {
          id: true,
          jobs: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            include: { submission: { select: { id: true } } },
          },
          submissions: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { id: true },
          },
        },
      });
      const byId = new Map(state.map((row) => [row.id, row]));
      return {
        items: rows.map((row) => {
          const latest = byId.get(row.familyId)!;
          return {
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            publishedAt: row.publishedAt?.toISOString() ?? null,
            withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
            latestJob: latest.jobs[0]
              ? fontJobDto(latest.jobs[0], latest.jobs[0].submission?.id)
              : null,
            latestSubmissionId: latest.submissions[0]?.id ?? null,
          };
        }),
        total: total,
        listingRevision: head.listingRevision,
        catalogRevision: head.revision,
        nextCursor:
          offset + rows.length < total
            ? Buffer.from(
                JSON.stringify({
                  version: 1,
                  revision: head.listingRevision,
                  filter,
                  offset: offset + rows.length,
                }),
              ).toString('base64url')
            : null,
      };
    });
  }

  async reorder(dto: ReorderFontsDto, actor: FontActor): Promise<FontReorderResultDto> {
    this.storage.requireConfigured();
    return this.prisma.$transaction(async (tx) => {
      await lockFontActor(tx, actor.actorId);
      await lockFontState(tx);
      const head = await tx.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
      if (head.revision !== dto.expectedCatalogRevision) fontConflict();
      const languages = new Set(dto.groups.map((group) => group.language));
      if (languages.size !== dto.groups.length) fontConflict();
      const families = await tx.textFontFamily.findMany({
        where: { enabled: true, currentVersionId: { not: null } },
        include: { currentVersion: true },
      });
      const selectable = families.filter(
        (family) => family.currentVersion?.publishedAt && !family.currentVersion.withdrawnAt,
      );
      const writes: { id: string; configuration: Prisma.InputJsonValue }[] = [];
      const seen = new Set<string>();
      for (const group of dto.groups) {
        const members = selectable
          .filter(
            (family) =>
              fontConfiguration(family.currentVersion!.configuration).designLanguage ===
              group.language,
          )
          .sort(
            (a, b) =>
              fontConfiguration(a.configuration).sortOrder -
                fontConfiguration(b.configuration).sortOrder || a.id.localeCompare(b.id),
          );
        if (members.length !== group.items.length) fontConflict();
        const byId = new Map(members.map((member) => [member.id, member]));
        for (const item of group.items) {
          const member = byId.get(item.familyId);
          if (seen.has(item.familyId) || !member || member.revision !== item.expectedFamilyRevision)
            fontConflict();
          seen.add(item.familyId);
        }
        if (group.items.every((item, index) => item.familyId === members[index].id)) continue;
        group.items.forEach((item, index) => {
          const member = byId.get(item.familyId)!;
          const config = fontConfiguration(member.configuration);
          if (config.sortOrder !== index)
            writes.push({
              id: member.id,
              configuration: fontJson({ ...config, sortOrder: index }),
            });
        });
      }
      if (!writes.length)
        return {
          changed: false,
          catalogRevision: head.revision,
          listingRevision: head.listingRevision,
        };
      for (const write of writes)
        await tx.textFontFamily.update({
          where: { id: write.id },
          data: { configuration: write.configuration, revision: { increment: 1 } },
        });
      const catalogRevision = await publishFontCatalog(tx);
      const listingRevision = await bumpFontListing(tx);
      await this.audit.record(
        {
          ...actor,
          action: 'TEXT_FONT_DRAFT_UPDATED',
          targetType: 'TEXT_FONT',
          targetId: 'font-catalog',
          metadata: {
            operation: 'reorder',
            languages: [...languages],
            familyCount: writes.length,
            revision: catalogRevision,
          },
        },
        tx,
      );
      return { changed: true, catalogRevision, listingRevision };
    });
  }
}
