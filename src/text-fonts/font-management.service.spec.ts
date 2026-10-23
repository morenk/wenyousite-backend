import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { FontStorageService } from './font-storage.service';
import { FontManagementService } from './font-management.service';
import { FontManagementQueryDto, ReorderFontsDto } from './dto/font-management.dto';
import { publishFontCatalog } from './font-catalog-publisher';

jest.mock('./font-catalog-publisher', () => ({ publishFontCatalog: jest.fn(async () => 8) }));
const fid = (number: number) => 'tff_' + number.toString(16).padStart(32, '0');
const actor = { actorId: 'unit-admin' };
function setup() {
  const head = { revision: 7, listingRevision: 9 };
  const rows = [1, 2, 3].map((number) => ({
    id: fid(number),
    revision: 1,
    enabled: true,
    configuration: {
      name: `Font ${number}`,
      designLanguage: number === 3 ? 'zh' : 'en',
      sortOrder: number * 10,
    },
    currentVersion: {
      publishedAt: new Date(),
      withdrawnAt: null as Date | null,
      configuration: { name: `Font ${number}`, designLanguage: number === 3 ? 'zh' : 'en' },
    },
  }));
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: actor.actorId }]),
    textFontCatalogHead: {
      findUniqueOrThrow: jest.fn(async () => head),
      update: jest.fn(async () => ({ ...head, listingRevision: head.listingRevision + 1 })),
    },
    textFontFamily: {
      findMany: jest.fn(async () => rows.filter((row) => row.enabled)),
      update: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const service = new FontManagementService(
    {
      $transaction: async (body: (value: typeof tx) => Promise<unknown>) => body(tx),
    } as unknown as PrismaService,
    { requireConfigured: jest.fn() } as unknown as FontStorageService,
    audit as unknown as AuditService,
  );
  const dto: ReorderFontsDto = {
    expectedCatalogRevision: 7,
    groups: [
      {
        language: 'en',
        items: [
          { familyId: fid(2), expectedFamilyRevision: 1 },
          { familyId: fid(1), expectedFamilyRevision: 1 },
        ],
      },
      { language: 'zh', items: [{ familyId: fid(3), expectedFamilyRevision: 1 }] },
    ],
  };
  return { service, tx, audit, head, rows, dto };
}
beforeEach(() => jest.clearAllMocks());

it('批量完整集合验证后只生成一份目录、一次列表修订和一次审计', async () => {
  const s = setup();
  await expect(s.service.reorder(s.dto, actor)).resolves.toEqual({
    changed: true,
    catalogRevision: 8,
    listingRevision: 10,
  });
  expect(s.tx.textFontFamily.update).toHaveBeenCalledTimes(2);
  expect(s.tx.textFontFamily.update).toHaveBeenCalledWith({
    where: { id: fid(2) },
    data: {
      configuration: { ...s.rows[1].configuration, sortOrder: 0 },
      revision: { increment: 1 },
    },
  });
  expect(publishFontCatalog).toHaveBeenCalledTimes(1);
  expect(s.tx.textFontCatalogHead.update).toHaveBeenCalledTimes(1);
  expect(s.audit.record).toHaveBeenCalledTimes(1);
});

it('顺序未变不重写稀疏排序值，不产生目录、修订或审计', async () => {
  const s = setup();
  s.dto.groups[0].items.reverse();
  await expect(s.service.reorder(s.dto, actor)).resolves.toEqual({
    changed: false,
    catalogRevision: 7,
    listingRevision: 9,
  });
  expect(s.tx.textFontFamily.update).not.toHaveBeenCalled();
  expect(publishFontCatalog).not.toHaveBeenCalled();
  expect(s.tx.textFontCatalogHead.update).not.toHaveBeenCalled();
  expect(s.audit.record).not.toHaveBeenCalled();
});

it.each([
  'catalog',
  'family',
  'missing',
  'duplicate-member',
  'duplicate-language',
  'cross-language',
  'disabled',
  'withdrawn',
  'new-member',
] as const)('%s 冲突在任何组写入前拒绝', async (kind) => {
  const s = setup();
  if (kind === 'catalog') s.head.revision++;
  if (kind === 'family') s.rows[0].revision++;
  if (kind === 'missing') s.dto.groups[0].items.pop();
  if (kind === 'duplicate-member') s.dto.groups[0].items[1] = s.dto.groups[0].items[0];
  if (kind === 'duplicate-language') s.dto.groups[1].language = 'en';
  if (kind === 'cross-language')
    [s.dto.groups[0].items[0], s.dto.groups[1].items[0]] = [
      s.dto.groups[1].items[0],
      s.dto.groups[0].items[0],
    ];
  if (kind === 'disabled') s.rows[0].enabled = false;
  if (kind === 'withdrawn') s.rows[0].currentVersion.withdrawnAt = new Date();
  if (kind === 'new-member') s.rows.push({ ...s.rows[0], id: fid(4) });
  await expect(s.service.reorder(s.dto, actor)).rejects.toMatchObject({ errorCode: 40928 });
  expect(s.tx.textFontFamily.update).not.toHaveBeenCalled();
  expect(publishFontCatalog).not.toHaveBeenCalled();
  expect(s.audit.record).not.toHaveBeenCalled();
});

it('管理投影只对当前页装配任务绑定，并拒绝已经变化的列表游标', async () => {
  const s = setup(),
    now = new Date();
  const rows = Array.from({ length: 21 }, (_, index) => ({
    familyId: fid(index + 1),
    name: `Font ${index}`,
    language: 'en',
    sortOrder: index,
    revision: 1,
    enabled: true,
    status: 'enabled',
    currentVersionId: null,
    lastPublishedVersionId: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    withdrawnAt: null,
  }));
  s.tx.$queryRaw.mockResolvedValue(rows);
  s.tx.textFontFamily.findMany.mockResolvedValue(
    rows.map((row) => ({
      id: row.familyId,
      jobs: [],
      submissions: [],
    })) as unknown as typeof s.rows,
  );
  const first = await s.service.list(new FontManagementQueryDto());
  expect(first.items).toHaveLength(20);
  expect(first.total).toBe(21);
  expect(first.nextCursor).toBeTruthy();
  expect(first.items[0]).toMatchObject({
    latestJob: null,
    latestSubmissionId: null,
    createdAt: now.toISOString(),
  });
  const second = await s.service.list(
    Object.assign(new FontManagementQueryDto(), { cursor: first.nextCursor }),
  );
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  s.head.listingRevision++;
  await expect(
    s.service.list(Object.assign(new FontManagementQueryDto(), { cursor: first.nextCursor })),
  ).rejects.toMatchObject({ errorCode: 40931 });
});
