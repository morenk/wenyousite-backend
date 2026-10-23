import { FontAdminService } from './font-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { FontStorageService } from './font-storage.service';
import { AuditService } from '../moderation/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { FontQueryService } from './font-query.service';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { publishFontCatalog } from './font-catalog-publisher';
import { Prisma } from '@prisma/client';

const familyId = 'tff_' + 'a'.repeat(32),
  versionId = 'tfv_' + 'b'.repeat(32),
  jobId = 'tfj_' + 'c'.repeat(32);
const actor = { actorId: 'admin' };
const config: FontConfigurationDto = {
  name: '测试字体',
  designLanguage: 'zh',
  sortOrder: 1,
  author: '作者',
  sourceUrl: 'https://example.invalid/font',
  licenseName: 'OFL',
  licenseText: '许可',
  specimenText: '温油',
  rights: { redistribution: true, conversion: true, subsetting: true },
};
function setup() {
  const family = {
    id: familyId,
    revision: 1,
    enabled: true,
    currentVersionId: null,
    configuration: structuredClone(config),
  };
  const job = {
    id: jobId,
    familyId,
    configuration: structuredClone(config),
    status: 'DRAFT',
    attempt: 0,
    sourceSha256: 'd'.repeat(64),
    sourceBytes: 4,
    versionId: null,
    failureCode: null,
  };
  const version = {
    id: versionId,
    familyId,
    artifactKey: 'artifact',
    configuration: structuredClone(config),
    publishedAt: null as Date | null,
    withdrawnAt: null as Date | null,
    artifact: { assets: [], specimenSha: 'd'.repeat(64), specimenSize: 4 },
  };
  const head = { revision: 3, listingRevision: 0 };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: actor.actorId }]),
    textFontFamily: {
      create: jest.fn().mockResolvedValue(family),
      findUnique: jest.fn().mockResolvedValue(family),
      findUniqueOrThrow: jest.fn().mockResolvedValue(family),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ ...family, revision: 2 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    textFontBuildJob: {
      create: jest.fn().mockResolvedValue(job),
      findUnique: jest.fn().mockResolvedValue(job),
      update: jest.fn().mockResolvedValue({ ...job, status: 'QUEUED', attempt: 1 }),
    },
    textFontVersion: {
      findFirst: jest.fn().mockResolvedValue(version),
      findUnique: jest.fn().mockResolvedValue(version),
      update: jest.fn().mockResolvedValue(version),
    },
    textFontCatalogHead: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(head),
      update: jest.fn().mockResolvedValue({ ...head, listingRevision: 1 }),
    },
    textFontCatalogRelease: { create: jest.fn().mockResolvedValue({ id: 'release' }) },
  };
  const transaction = jest.fn(async (body: (value: typeof tx) => Promise<unknown>) => body(tx));
  const storage = {
    requireConfigured: jest.fn(),
    putSource: jest
      .fn()
      .mockResolvedValue({ sha256: job.sourceSha256, bytes: 4, key: 'private-key' }),
    verifyAssets: jest.fn(),
  };
  const audit = { record: jest.fn() },
    outbox = { enqueue: jest.fn() },
    queries = { version: jest.fn().mockResolvedValue({ status: 'withdrawn' }) };
  const service = new FontAdminService(
    { ...tx, $transaction: transaction } as unknown as PrismaService,
    storage as unknown as FontStorageService,
    audit as unknown as AuditService,
    outbox as unknown as OutboxService,
    queries as unknown as FontQueryService,
  );
  return { service, tx, transaction, storage, audit, outbox, queries, family, version, job, head };
}
const publish = { versionId, expectedFamilyRevision: 1, expectedCatalogRevision: 3 };

describe('字体管理写入策略', () => {
  it('保存草稿与审计共用事务，响应不包含存储位置', async () => {
    const s = setup();
    await expect(s.service.create(config, actor)).resolves.toMatchObject({
      familyId,
      revision: 1,
      catalogRevision: 3,
    });
    expect(s.tx.textFontFamily.create).toHaveBeenCalledWith({
      data: { id: expect.stringMatching(/^tff_[a-f0-9]{32}$/), configuration: config },
    });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEXT_FONT_DRAFT_UPDATED' }),
      s.tx,
    );
    await expect(
      s.service.update(familyId, { ...config, expectedFamilyRevision: 1 }, actor),
    ).resolves.toMatchObject({ revision: 2 });
    expect(s.tx.textFontFamily.update).toHaveBeenCalledWith({
      where: { id: familyId },
      data: { configuration: config, specimenAutomatic: false, revision: { increment: 1 } },
    });
  });
  it('无效身份、已删除操作人和过期修订均不能写入', async () => {
    const s = setup();
    await expect(
      s.service.update('bad', { ...config, expectedFamilyRevision: 1 }, actor),
    ).rejects.toMatchObject({ status: 404 });
    s.tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(s.service.create(config, actor)).rejects.toMatchObject({ status: 403 });
    await expect(
      s.service.update(familyId, { ...config, expectedFamilyRevision: 0 }, actor),
    ).rejects.toMatchObject({ status: 409 });
    s.tx.textFontFamily.findUnique.mockResolvedValueOnce(null);
    await expect(
      s.service.update(familyId, { ...config, expectedFamilyRevision: 1 }, actor),
    ).rejects.toMatchObject({ status: 404 });
    expect(s.tx.textFontFamily.update).not.toHaveBeenCalled();
    expect(s.audit.record).not.toHaveBeenCalled();
  });
  it('上传前后都检查修订，远端写入期间发生变更不会创建作业', async () => {
    const s = setup();
    const query = { format: 'ttf' as const, expectedFamilyRevision: 1 };
    await expect(
      s.service.upload(familyId, query, Buffer.from('font'), actor),
    ).resolves.toMatchObject({ status: 'draft', sourceBytes: 4 });
    expect(s.tx.textFontBuildJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ configuration: config, sourceKey: 'private-key' }),
    });
    s.tx.textFontBuildJob.create.mockClear();
    s.tx.textFontFamily.findUniqueOrThrow.mockResolvedValueOnce({ ...s.family, revision: 2 });
    await expect(
      s.service.upload(familyId, query, Buffer.from('font'), actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(s.tx.textFontBuildJob.create).not.toHaveBeenCalled();
    s.storage.putSource.mockClear();
    await expect(
      s.service.upload(
        familyId,
        { ...query, expectedFamilyRevision: 0 },
        Buffer.from('font'),
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    s.tx.textFontFamily.findUnique.mockResolvedValueOnce(null);
    await expect(
      s.service.upload(familyId, query, Buffer.from('font'), actor),
    ).rejects.toMatchObject({ status: 404 });
    expect(s.storage.putSource).not.toHaveBeenCalled();
  });
  it('处理请求生成稳定构建身份并在同一事务投递唯一 attempt，重复请求不重复投递', async () => {
    const s = setup();
    await expect(s.service.process(jobId, actor)).resolves.toMatchObject({ status: 'queued' });
    expect(s.tx.textFontBuildJob.update).toHaveBeenCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({
        buildKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        attempt: { increment: 1 },
        failureCode: null,
      }),
    });
    expect(s.outbox.enqueue).toHaveBeenCalledWith(
      s.tx,
      expect.objectContaining({
        eventKey: `text-font-build:${jobId}:1`,
        payload: { jobId, attempt: 1 },
      }),
    );
    s.job.status = 'QUEUED';
    await s.service.process(jobId, actor);
    expect(s.outbox.enqueue).toHaveBeenCalledTimes(1);
    s.job.status = 'FAILED';
    s.job.configuration.rights.subsetting = false;
    await expect(s.service.process(jobId, actor)).rejects.toMatchObject({ status: 409 });
    s.tx.textFontBuildJob.findUnique.mockResolvedValueOnce(null);
    await expect(s.service.process(jobId, actor)).rejects.toMatchObject({ status: 404 });
    expect(s.outbox.enqueue).toHaveBeenCalledTimes(1);
  });
  it('发布先校验远端资源，再原子更新版本、当前指针、目录与审计', async () => {
    const s = setup();
    s.storage.verifyAssets.mockImplementation(async () =>
      expect(s.transaction).not.toHaveBeenCalled(),
    );
    await expect(s.service.publish(familyId, publish, actor)).resolves.toMatchObject({
      catalogRevision: 4,
    });
    expect(s.tx.textFontVersion.update).toHaveBeenCalledWith({
      where: { id: versionId },
      data: { publishedAt: expect.any(Date) },
    });
    expect(s.tx.textFontFamily.update).toHaveBeenCalledWith({
      where: { id: familyId },
      data: {
        currentVersionId: versionId,
        lastPublishedVersionId: versionId,
        revision: { increment: 1 },
      },
    });
    expect(s.tx.textFontCatalogHead.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { revision: 4, releaseId: 'release' },
    });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEXT_FONT_PUBLISHED' }),
      s.tx,
    );
  });
  it.each(['family', 'catalog', 'withdrawn', 'artifact', 'ownership'] as const)(
    '发布期间 %s 变化拒绝提交',
    async (field) => {
      const s = setup();
      s.storage.verifyAssets.mockImplementation(async () => {
        const current = { ...s.version };
        if (field === 'family') s.family.revision++;
        if (field === 'catalog') s.head.revision++;
        if (field === 'withdrawn') current.withdrawnAt = new Date();
        if (field === 'artifact') current.artifactKey = 'changed';
        if (field === 'ownership') current.familyId = 'other';
        s.tx.textFontVersion.findUnique.mockResolvedValue(current);
      });
      await expect(s.service.publish(familyId, publish, actor)).rejects.toMatchObject({
        status: 409,
      });
      expect(s.tx.textFontFamily.update).not.toHaveBeenCalled();
      expect(s.tx.textFontCatalogRelease.create).not.toHaveBeenCalled();
    },
  );
  it('缺失资源和缺失授权阻止发布，内部存储错误映射安全 503', async () => {
    const s = setup();
    s.storage.verifyAssets.mockRejectedValue(new Error('private-storage-secret'));
    await expect(s.service.publish(familyId, publish, actor)).rejects.toMatchObject({
      status: 503,
      message: '字体资源暂不可用，请稍后重试',
    });
    s.version.configuration.licenseText = '';
    await expect(s.service.publish(familyId, publish, actor)).rejects.toMatchObject({
      status: 409,
    });
    s.tx.textFontVersion.findFirst.mockResolvedValueOnce(null);
    await expect(s.service.publish(familyId, publish, actor)).rejects.toMatchObject({
      status: 404,
    });
    expect(s.transaction).not.toHaveBeenCalled();
  });
  it('回滚至已发布版本不重写发布时间，停用仍生成新目录快照', async () => {
    const s = setup();
    s.version.publishedAt = new Date(0);
    await s.service.publish(familyId, publish, actor);
    expect(s.tx.textFontVersion.update).not.toHaveBeenCalled();
    await s.service.enabled(familyId, { ...publish, enabled: false }, actor);
    expect(s.tx.textFontFamily.update).toHaveBeenLastCalledWith({
      where: { id: familyId },
      data: { enabled: false, revision: { increment: 1 } },
    });
    await expect(
      s.service.enabled(familyId, { ...publish, enabled: true, expectedCatalogRevision: 2 }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('撤回只清除仍指向该版本的指针；再次撤回幂等', async () => {
    const s = setup();
    const dto = { reason: '授权撤销', expectedCatalogRevision: 3 };
    await expect(s.service.withdraw(versionId, dto, actor)).resolves.toEqual({
      status: 'withdrawn',
    });
    expect(s.tx.textFontFamily.updateMany).toHaveBeenCalledWith({
      where: { id: familyId, currentVersionId: versionId },
      data: { currentVersionId: null, revision: { increment: 1 } },
    });
    expect(s.queries.version).toHaveBeenCalledWith(versionId, true);
    s.version.withdrawnAt = new Date();
    await s.service.withdraw(versionId, { ...dto, expectedCatalogRevision: 0 }, actor);
    expect(s.tx.textFontVersion.update).toHaveBeenCalledTimes(1);
    expect(s.audit.record).toHaveBeenCalledTimes(1);
  });
  it('撤回冲突或版本不存在时不写入', async () => {
    const s = setup();
    await expect(
      s.service.withdraw(versionId, { reason: '撤回', expectedCatalogRevision: 0 }, actor),
    ).rejects.toMatchObject({ status: 409 });
    s.tx.textFontVersion.findUnique.mockResolvedValueOnce(null);
    await expect(
      s.service.withdraw(versionId, { reason: '撤回', expectedCatalogRevision: 3 }, actor),
    ).rejects.toMatchObject({ status: 404 });
    expect(s.tx.textFontVersion.update).not.toHaveBeenCalled();
  });
});

it('目录仅快照可选版本：展示配置来自不可变版本，排序来自当前家族配置', async () => {
  const s = setup();
  const selected = {
    ...s.version,
    publishedAt: new Date(),
    configuration: { ...config, name: '已发布名称' },
  };
  s.tx.textFontFamily.findMany.mockResolvedValue([
    { ...s.family, id: 'c', configuration: { ...config, sortOrder: 2 }, currentVersion: selected },
    { ...s.family, id: 'b', currentVersion: selected },
    { ...s.family, id: 'a', currentVersion: selected },
    { ...s.family, id: 'draft', currentVersion: s.version },
    { ...s.family, id: 'withdrawn', currentVersion: { ...selected, withdrawnAt: new Date() } },
    { ...s.family, id: 'missing', currentVersion: null },
  ]);
  await expect(publishFontCatalog(s.tx as unknown as Prisma.TransactionClient)).resolves.toBe(4);
  const entries = s.tx.textFontCatalogRelease.create.mock.calls[0][0].data.entries;
  expect(entries.map((entry: { familyId: string }) => entry.familyId)).toEqual(['a', 'b', 'c']);
  expect(entries[0]).toMatchObject({ name: '已发布名称', selectable: true, renderAllowed: true });
});
