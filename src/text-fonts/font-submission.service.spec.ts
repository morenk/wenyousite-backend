import { randomUUID } from 'node:crypto';
import { Prisma, TextFontBuildJob, TextFontFamily, TextFontSubmission } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { FontStorageService } from './font-storage.service';
import { FontSubmissionService } from './font-submission.service';
import { CreateFontSubmissionDto } from './dto/font-management.dto';
import { fontSha } from './font-domain';
import * as catalogPublisher from './font-catalog-publisher';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FontConfigurationDto } from './dto/font-admin.dto';

const actor = { actorId: 'unit-admin' };
const familyId = 'tff_' + 'a'.repeat(32);
const config = {
  name: '已有字体',
  designLanguage: 'other',
  sortOrder: 7,
  author: '保存作者',
  sourceUrl: 'https://example.invalid/font',
  licenseName: '保存许可',
  licenseText: '许可原文',
  specimenText: 'Custom AB',
  rights: { redistribution: true, conversion: true, subsetting: true },
};
const input = () =>
  Object.assign(new CreateFontSubmissionDto(), { submissionId: randomUUID(), name: '新名称' });

function setup() {
  const now = new Date();
  let family: TextFontFamily = {
    id: familyId,
    configuration: config,
    revision: 1,
    enabled: true,
    currentVersionId: null,
    lastPublishedVersionId: null,
    nextVersion: 1,
    legacyId: null,
    createdAt: now,
    updatedAt: now,
    specimenAutomatic: false,
  };
  let submission: TextFontSubmission | null = null;
  let job: TextFontBuildJob | null = null;
  const intents = new Map<string, { attempt: number }>();
  const snapshot = () => (submission ? { ...submission, family, job } : null);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: actor.actorId, maximum: 12 }]),
    textFontFamily: {
      findUnique: jest.fn(async () => family),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Pick<TextFontFamily, 'id' | 'configuration'> & { specimenAutomatic: boolean };
        }) => {
          family = { ...family, ...data };
          return family;
        },
      ),
      update: jest.fn(async ({ data }: { data: { configuration: Prisma.JsonValue } }) => {
        family = { ...family, configuration: data.configuration, revision: family.revision + 1 };
        return family;
      }),
    },
    textFontCatalogHead: { update: jest.fn().mockResolvedValue({ listingRevision: 1 }) },
    textFontSubmission: {
      findUnique: jest.fn(async () => snapshot()),
      findUniqueOrThrow: jest.fn(async () => snapshot()),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<TextFontSubmission, 'jobId' | 'createdAt' | 'updatedAt'>;
        }) => {
          submission = { ...data, jobId: null, createdAt: now, updatedAt: now };
          return snapshot();
        },
      ),
      update: jest.fn(async ({ data }: { data: { jobId: string } }) => {
        submission = { ...submission!, jobId: data.jobId };
        return snapshot();
      }),
    },
    textFontBuildJob: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Pick<
            TextFontBuildJob,
            | 'id'
            | 'familyId'
            | 'configuration'
            | 'parametersVersion'
            | 'uploadAuthorization'
            | 'sourceSha256'
            | 'sourceBytes'
            | 'sourceKey'
            | 'sourceFormat'
          >;
        }) => {
          job = {
            ...data,
            status: 'DRAFT',
            attempt: 0,
            buildKey: null,
            versionId: null,
            claimToken: null,
            leaseExpiresAt: null,
            failureCode: null,
            failureReason: null,
            createdAt: now,
            updatedAt: now,
          };
          return job;
        },
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        job = {
          ...job!,
          ...data,
          attempt: job!.attempt + (data.attempt as { increment: number }).increment,
        };
        return job;
      }),
    },
    textFontProcessRequest: {
      findUnique: jest.fn(
        async ({ where }: { where: { submissionId_requestId: { requestId: string } } }) =>
          intents.get(where.submissionId_requestId.requestId) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: { requestId: string; attempt: number } }) => {
        intents.set(data.requestId, { attempt: data.attempt });
        return data;
      }),
    },
  };
  const storage = {
    requireConfigured: jest.fn(),
    putSource: jest.fn(async (source: Buffer, format: string) => ({
      sha256: fontSha(source),
      key: `${fontSha(source)}.${format}`,
      bytes: source.length,
    })),
  };
  const audit = { record: jest.fn() },
    outbox = { enqueue: jest.fn() };
  const service = new FontSubmissionService(
    {
      ...tx,
      $transaction: async (body: (value: typeof tx) => Promise<unknown>) => body(tx),
    } as unknown as PrismaService,
    storage as unknown as FontStorageService,
    audit as unknown as AuditService,
    outbox as unknown as OutboxService,
  );
  return {
    service,
    tx,
    storage,
    audit,
    outbox,
    family: () => family,
    submission: () => submission!,
    job: () => job!,
  };
}

it('创建提交去重早于家族修订，键不能被其他内容或操作者复用', async () => {
  const s = setup(),
    dto = input();
  const first = await s.service.create(dto, actor);
  expect(first).toMatchObject({ name: dto.name, language: 'other', sortOrder: 13, job: null });
  expect(s.family().specimenAutomatic).toBe(true);
  s.family().revision++;
  expect((await s.service.create(dto, actor)).familyId).toBe(first.familyId);
  await expect(s.service.create({ ...dto, name: '不同内容' }, actor)).rejects.toMatchObject({
    errorCode: 40930,
  });
  await expect(s.service.create(dto, { actorId: 'other-admin' })).rejects.toMatchObject({
    errorCode: 40930,
  });
  expect(s.tx.textFontFamily.create).toHaveBeenCalledTimes(1);
  expect(s.audit.record).toHaveBeenCalledTimes(1);
});

it('已有家族保留补充资料、顺序和自定义样张，过期修订不能创建提交', async () => {
  const s = setup(),
    dto = { ...input(), familyId, expectedFamilyRevision: 1, language: 'ja' as const };
  await expect(
    s.service.create({ ...dto, expectedFamilyRevision: 0 }, actor),
  ).rejects.toMatchObject({ errorCode: 40928 });
  await s.service.create(dto, actor);
  expect(s.submission().configuration).toEqual({ ...config, name: dto.name, designLanguage: 'ja' });
  expect(s.family().revision).toBe(2);
  expect(s.tx.textFontFamily.create).not.toHaveBeenCalled();
});

it.each([
  ['zh', '温油文字 Aa 0123'],
  ['ja', '温油文字 Aa 0123'],
  ['en', 'Wenyou Aa 0123'],
  ['other', 'Wenyou Aa 0123'],
] as const)('新建 %s 提交选取语言默认样张', async (language, specimenText) => {
  const s = setup();
  await s.service.create({ ...input(), language }, actor);
  expect(s.submission().configuration).toMatchObject({ specimenText });
});

it.each(['en', 'other'] as const)(
  '已有自动家族的新 %s 提交更新默认值，保留补充资料',
  async (language) => {
    const s = setup();
    s.family().specimenAutomatic = true;
    s.family().configuration = { ...config, specimenText: 'Aa Bb Cc 0123456789' };
    await s.service.create({ ...input(), familyId, expectedFamilyRevision: 1, language }, actor);
    expect(s.submission().configuration).toMatchObject({
      author: config.author,
      specimenText: 'Wenyou Aa 0123',
    });
  },
);

it('历史自动提交重放、首次上传及失败重试保留原样张快照', async () => {
  const s = setup(),
    dto = { ...input(), language: 'en' as const };
  const created = await s.service.create(dto, actor);
  const original = {
    ...(s.submission().configuration as Prisma.JsonObject),
    specimenText: 'The quick brown fox jumps over the lazy dog. 0123456789',
  };
  s.submission().configuration = original;
  await s.service.create(dto, actor);
  expect(s.submission().configuration).toEqual(original);
  await s.service.upload(
    created.familyId,
    { submissionId: dto.submissionId, expectedFamilyRevision: 1, format: 'ttf' },
    Buffer.from('source'),
    actor,
  );
  const first = await s.service.process(dto.submissionId, randomUUID(), actor);
  const buildKey = s.job().buildKey;
  s.job().status = 'FAILED';
  await s.service.process(dto.submissionId, randomUUID(), actor);
  expect(s.job()).toMatchObject({ id: first.jobId, configuration: original, buildKey, attempt: 2 });
  expect(s.family().configuration).toMatchObject({ specimenText: 'Wenyou Aa 0123' });
});

it('源首次绑定确认与任务，重复源不再 PUT，换源被拒绝', async () => {
  const s = setup();
  const dto = input();
  const created = await s.service.create(dto, actor);
  const query = {
      submissionId: dto.submissionId,
      expectedFamilyRevision: created.familyRevision,
      format: 'ttf' as const,
    },
    source = Buffer.from('source');
  const first = await s.service.upload(created.familyId, query, source, actor);
  expect(first.submissionId).toBe(dto.submissionId);
  expect(s.job().uploadAuthorization).toMatchObject({
    actorId: actor.actorId,
    sourceSha256: fontSha(source),
    ruleVersion: 'admin-font-upload-v1',
  });
  expect((s.job().uploadAuthorization as { confirmedAt: string }).confirmedAt).toMatch(/^\d{4}-/u);
  s.family().revision++;
  expect(await s.service.upload(created.familyId, query, source, actor)).toEqual(first);
  expect(s.storage.putSource).toHaveBeenCalledTimes(1);
  expect((await s.service.get(dto.submissionId)).job?.submissionId).toBe(dto.submissionId);
  await expect(
    s.service.upload(created.familyId, query, Buffer.from('different'), actor),
  ).rejects.toMatchObject({ errorCode: 40930 });
  expect(s.tx.textFontBuildJob.create).toHaveBeenCalledTimes(1);
});

it('远端暂存期间家族变化，拒绝绑定且不写任务与授权', async () => {
  const s = setup(),
    dto = input(),
    source = Buffer.from('source');
  const created = await s.service.create(dto, actor);
  s.storage.putSource.mockImplementation(async () => {
    s.family().revision++;
    return { sha256: fontSha(source), key: 'private-key', bytes: source.length };
  });
  await expect(
    s.service.upload(
      created.familyId,
      {
        submissionId: dto.submissionId,
        expectedFamilyRevision: created.familyRevision,
        format: 'ttf',
      },
      source,
      actor,
    ),
  ).rejects.toMatchObject({ errorCode: 40928 });
  expect(s.tx.textFontBuildJob.create).not.toHaveBeenCalled();
  expect((await s.service.get(dto.submissionId)).job).toBeNull();
});

it('失败后的旧处理意图不重试，明确新意图复用同一源并仅新增一次尝试', async () => {
  const s = setup(),
    dto = input();
  const created = await s.service.create(dto, actor);
  await expect(s.service.process(dto.submissionId, randomUUID(), actor)).rejects.toMatchObject({
    errorCode: 40928,
  });
  await s.service.upload(
    created.familyId,
    { submissionId: dto.submissionId, expectedFamilyRevision: 1, format: 'ttf' },
    Buffer.from('source'),
    actor,
  );
  const requestId = randomUUID();
  expect(await s.service.process(dto.submissionId, requestId, actor)).toMatchObject({
    status: 'queued',
    submissionId: dto.submissionId,
  });
  await s.service.process(dto.submissionId, randomUUID(), actor);
  expect(s.outbox.enqueue).toHaveBeenCalledTimes(1);
  s.job().status = 'FAILED';
  await s.service.process(dto.submissionId, requestId, actor);
  expect(s.job().attempt).toBe(1);
  await s.service.process(dto.submissionId, randomUUID(), actor);
  expect(s.job().attempt).toBe(2);
  expect(s.outbox.enqueue).toHaveBeenCalledTimes(2);
  expect(s.storage.putSource).toHaveBeenCalledTimes(1);
});

it('缺失记录、非法家族和空原件均拒绝', async () => {
  const s = setup();
  await expect(s.service.get(randomUUID())).rejects.toMatchObject({ status: 404 });
  await expect(s.service.process(randomUUID(), randomUUID(), actor)).rejects.toMatchObject({
    status: 404,
  });
  const query = { submissionId: randomUUID(), expectedFamilyRevision: 1, format: 'ttf' as const };
  await expect(
    s.service.upload('invalid', query, Buffer.from('source'), actor),
  ).rejects.toMatchObject({ status: 404 });
  await expect(s.service.upload(familyId, query, Buffer.alloc(0), actor)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    s.service.upload(familyId, query, Buffer.from('source'), actor),
  ).rejects.toMatchObject({ status: 404 });
});

it('合法顺序上限后追加会压紧同语言顺序并发布一次目录，重放不重复归一化', async () => {
  const s = setup();
  s.tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('max(')) return [{ maximum: 1000000, total: 3 }];
    if (sql.includes('WITH ordered')) return [{ changed: 2 }];
    return [{ id: actor.actorId }];
  });
  const publish = jest.spyOn(catalogPublisher, 'publishFontCatalog').mockResolvedValue(9);
  try {
    const dto = input();
    const created = await s.service.create(dto, actor);
    expect(created.sortOrder).toBe(3);
    expect(validateSync(plainToInstance(FontConfigurationDto, s.family().configuration))).toEqual(
      [],
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'font-catalog',
        metadata: {
          operation: 'normalize-sort-order',
          language: 'other',
          familyCount: 2,
          revision: 9,
        },
      }),
      s.tx,
    );
    expect(s.tx.textFontCatalogHead.update).toHaveBeenCalledTimes(1);
    expect((await s.service.create(dto, actor)).familyId).toBe(created.familyId);
    expect(publish).toHaveBeenCalledTimes(1);
  } finally {
    publish.mockRestore();
  }
});

it('最后一个合法顺序仍可直接追加；无法容纳新家族时不产生半完成写入', async () => {
  const s = setup();
  s.tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join('').includes('max(') ? [{ maximum: 999999, total: 2 }] : [{ id: actor.actorId }],
  );
  expect((await s.service.create(input(), actor)).sortOrder).toBe(1000000);
  const full = setup();
  full.tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join('').includes('max(')
      ? [{ maximum: 1000000, total: 1000001 }]
      : [{ id: actor.actorId }],
  );
  await expect(full.service.create(input(), actor)).rejects.toMatchObject({ errorCode: 40928 });
  expect(full.tx.textFontFamily.create).not.toHaveBeenCalled();
  expect(full.tx.textFontFamily.update).not.toHaveBeenCalled();
  expect(full.audit.record).not.toHaveBeenCalled();
});
