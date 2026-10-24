import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FontProcessingService } from './font-processing.service';
import { FontProcessingFailure, FontSandboxService } from './font-sandbox.service';
import { FontStorageService } from './font-storage.service';
import { FontWorkDirectoryService } from './font-work-directory.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { fontSha } from './font-domain';
import { fontBuildIdentity } from './font-build-identity';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { FontManifest } from './font-manifest';

jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  lstat: jest.fn(),
}));
const jobId = 'tfj_' + 'a'.repeat(32),
  familyId = 'tff_' + 'b'.repeat(32),
  versionId = 'tfv_' + 'c'.repeat(32);
async function setup() {
  const config: FontConfigurationDto = {
    name: '字体',
    designLanguage: 'zh',
    sortOrder: 0,
    author: '作者',
    sourceUrl: 'https://example.invalid',
    licenseName: 'OFL',
    licenseText: '许可',
    specimenText: '样张',
    rights: { redistribution: true, conversion: true, subsetting: true },
  };
  const source = Buffer.from([0, 1, 0, 0]);
  const identity = await fontBuildIdentity(fontSha(source), config);
  let current = {
    id: jobId,
    familyId,
    attempt: 1,
    status: 'QUEUED',
    configuration: config,
    sourceSha256: fontSha(source),
    sourceBytes: source.length,
    sourceKey: 'source-key',
    buildKey: identity.key,
    claimToken: null as string | null,
    leaseExpiresAt: null as Date | null,
  };
  const files = new Map<string, Buffer>();
  const asset = (format: 'ttf' | 'woff2' | 'json' | 'png', bytes: Buffer) => {
    const descriptor = { sha256: fontSha(bytes), bytes: bytes.length, format };
    files.set(`${descriptor.sha256}.${format}`, bytes);
    return descriptor;
  };
  const manifest: FontManifest = {
    manifestVersion: 2,
    buildKey: identity.key,
    sourceSha256: current.sourceSha256,
    baseWeight: 400,
    baseStyle: 'normal',
    coverage: { unicodeRanges: ['U+0041'], codepointCount: 1 },
    shards: [
      {
        id: 'latin',
        family: `WYF2-${identity.key.slice(0, 32)}-latin`,
        unicodeRanges: ['U+0041'],
        codepointCount: 1,
        web: asset('woff2', Buffer.from('wOF2')),
        mobile: asset('ttf', source),
      },
    ],
    notices: [asset('json', Buffer.from('{}'))],
    specimen: asset('png', Buffer.from([137, 80, 78, 71])),
  };
  const manifestAsset = asset('json', Buffer.from(JSON.stringify(manifest)));
  files.set('result.json', Buffer.from(JSON.stringify({ manifest: manifestAsset })));
  const artifact = {
    buildKey: identity.key,
    sourceSha256: current.sourceSha256,
    toolchain: identity.toolchain,
    manifest,
    assets: [manifestAsset],
    manifestSha: manifestAsset.sha256,
    manifestSize: manifestAsset.bytes,
    specimenSha: manifest.specimen.sha256,
    specimenSize: manifest.specimen.bytes,
  };
  const tx = {
    $queryRaw: jest.fn(),
    textFontBuildJob: {
      findUnique: jest.fn().mockImplementation(async () => ({ ...current })),
      update: jest.fn().mockImplementation(async ({ data }: { data: Partial<typeof current> }) => {
        current = { ...current, ...data };
        return { ...current };
      }),
      updateMany: jest
        .fn()
        .mockImplementation(
          async ({
            where,
            data,
          }: {
            where: Partial<typeof current>;
            data: Partial<typeof current>;
          }) => {
            if (
              !Object.entries(where).every(
                ([key, value]) => current[key as keyof typeof current] === value,
              )
            )
              return { count: 0 };
            current = { ...current, ...data };
            return { count: 1 };
          },
        ),
    },
    textFontArtifact: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest
        .fn()
        .mockImplementation(async ({ create }: { create: typeof artifact }) => create),
    },
    textFontCatalogHead: { update: jest.fn().mockResolvedValue({ listingRevision: 1 }) },
    textFontFamily: { update: jest.fn().mockResolvedValue({ nextVersion: 2 }) },
    textFontVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: versionId }),
    },
  };
  const transaction = jest.fn(async (body: (value: typeof tx) => Promise<unknown>) => body(tx));
  const storage = {
    readSource: jest.fn().mockResolvedValue(source),
    readChecked: jest.fn().mockImplementation(async (path: string) => {
      const bytes = files.get(basename(path));
      if (!bytes) throw new Error('private-path');
      return bytes;
    }),
    putAsset: jest.fn(),
    verifyAssets: jest.fn(),
  };
  const sandbox = { run: jest.fn() },
    audit = { record: jest.fn() };
  const ticket = { root: '/virtual/font-work' },
    work = { create: jest.fn().mockResolvedValue(ticket), remove: jest.fn() };
  jest.mocked(lstat).mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof lstat>>);
  const service = new FontProcessingService(
    { ...tx, $transaction: transaction } as unknown as PrismaService,
    storage as unknown as FontStorageService,
    sandbox as unknown as FontSandboxService,
    audit as unknown as AuditService,
    work as unknown as FontWorkDirectoryService,
  );
  return {
    service,
    tx,
    storage,
    sandbox,
    audit,
    work,
    ticket,
    artifact,
    files,
    identity,
    current: () => current,
  };
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('字体构建 claim、幂等与失败回收', () => {
  it('远端上传超过初始租期仍续租，完成后停止续租并清空租期', async () => {
    const s = await setup();
    jest.useFakeTimers();
    const started = signal(),
      finish = signal();
    s.storage.putAsset.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
    });
    const processing = s.service.process(jobId, 1);
    await started.promise;
    const initialExpiry = s.current().leaseExpiresAt!;
    await jest.advanceTimersByTimeAsync(720000);
    expect(initialExpiry.getTime()).toBeLessThan(Date.now());
    expect(s.current().leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(s.current()).toMatchObject({ status: 'PROCESSING', attempt: 1 });
    finish.resolve();
    await processing;
    expect(s.current()).toMatchObject({ status: 'READY', claimToken: null, leaseExpiresAt: null });
    const calls = s.tx.textFontBuildJob.updateMany.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000);
    expect(s.tx.textFontBuildJob.updateMany).toHaveBeenCalledTimes(calls);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('续租短暂失败后恢复；失去 claim 时不能延长新尝试的租期', async () => {
    const s = await setup();
    jest.useFakeTimers();
    const started = signal(),
      finish = signal();
    s.tx.textFontArtifact.findUnique.mockResolvedValue(s.artifact);
    s.storage.verifyAssets.mockImplementation(async () => {
      started.resolve();
      await finish.promise;
    });
    const processing = s.service.process(jobId, 1);
    await started.promise;
    const initialExpiry = s.current().leaseExpiresAt!;
    s.tx.textFontBuildJob.updateMany.mockRejectedValueOnce(new Error('private-database-password'));
    await jest.advanceTimersByTimeAsync(30000);
    expect(s.current().leaseExpiresAt).toEqual(initialExpiry);
    await jest.advanceTimersByTimeAsync(30000);
    expect(s.current().leaseExpiresAt!.getTime()).toBeGreaterThan(initialExpiry.getTime());
    s.current().attempt = 2;
    s.current().claimToken = 'new-owner';
    const newExpiry = s.current().leaseExpiresAt;
    await jest.advanceTimersByTimeAsync(30000);
    expect(s.current().leaseExpiresAt).toEqual(newExpiry);
    finish.resolve();
    await processing;
    expect(s.tx.textFontVersion.create).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('续租请求不重叠，失败退出会等待在途续租结束', async () => {
    const s = await setup();
    jest.useFakeTimers();
    const started = signal(),
      finish = signal(),
      renewal = signal();
    s.tx.textFontArtifact.findUnique.mockResolvedValue(s.artifact);
    s.storage.verifyAssets.mockImplementation(async () => {
      started.resolve();
      await finish.promise;
      throw new FontProcessingFailure('processing-failed');
    });
    s.tx.textFontBuildJob.updateMany.mockImplementationOnce(async () => {
      await renewal.promise;
      return { count: 0 };
    });
    const processing = s.service.process(jobId, 1);
    const rejected = expect(processing).rejects.toMatchObject({ code: 'processing-failed' });
    await started.promise;
    await jest.advanceTimersByTimeAsync(120000);
    expect(s.tx.textFontBuildJob.updateMany).toHaveBeenCalledTimes(1);
    finish.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(s.current().status).toBe('FAILED');
    expect(jest.getTimerCount()).toBe(0);
    renewal.resolve();
    await rejected;
  });
  it('核验所有产物后创建一个不可变版本，并释放登记工作目录', async () => {
    const s = await setup();
    await s.service.process(jobId, 1);
    expect(s.current()).toMatchObject({ status: 'READY', claimToken: null });
    expect(s.storage.putAsset).toHaveBeenCalledTimes(5);
    expect(s.tx.textFontVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionNumber: 1,
        artifactKey: s.identity.key,
        configuration: s.current().configuration,
      }),
    });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEXT_FONT_VERSION_READY' }),
      s.tx,
    );
    expect(s.work.remove).toHaveBeenCalledWith(s.ticket, true);
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledWith('/virtual/font-work/input/source', expect.any(Buffer), {
      flag: 'wx',
      mode: 0o400,
    });
    await s.service.process(jobId, 1);
    expect(s.tx.textFontVersion.create).toHaveBeenCalledTimes(1);
  });
  it('过期 attempt 或不存在的任务不读取源、不创建目录', async () => {
    const s = await setup();
    await s.service.process(jobId, 0);
    s.tx.textFontBuildJob.findUnique.mockResolvedValueOnce(null);
    await s.service.process(jobId, 1);
    expect(s.work.create).not.toHaveBeenCalled();
    expect(s.storage.readSource).not.toHaveBeenCalled();
  });
  it('复用已验证 artifact 和既有版本，重试不增长版本号', async () => {
    const s = await setup();
    s.tx.textFontArtifact.findUnique.mockResolvedValue(s.artifact);
    s.tx.textFontVersion.findUnique.mockResolvedValue({ id: versionId });
    await s.service.process(jobId, 1);
    expect(s.storage.verifyAssets).toHaveBeenCalledWith(s.artifact.assets);
    expect(s.work.create).not.toHaveBeenCalled();
    expect(s.tx.textFontFamily.update).not.toHaveBeenCalled();
    expect(s.tx.textFontVersion.create).not.toHaveBeenCalled();
    expect(s.current()).toMatchObject({ status: 'READY', versionId });
  });
  it('失去 claim 的旧消费者不能提交新版本或覆盖新 attempt', async () => {
    const s = await setup();
    s.tx.textFontArtifact.findUnique.mockResolvedValue(s.artifact);
    s.storage.verifyAssets.mockImplementation(async () => {
      s.current().claimToken = 'new-owner';
      s.current().attempt = 2;
    });
    await s.service.process(jobId, 1);
    expect(s.tx.textFontArtifact.upsert).not.toHaveBeenCalled();
    expect(s.tx.textFontVersion.create).not.toHaveBeenCalled();
    expect(s.current()).toMatchObject({ status: 'PROCESSING', attempt: 2 });
  });
  it.each([
    'source',
    'descriptor',
    'manifest-hash',
    'asset-hash',
    'result-size',
    'sandbox',
  ] as const)('%s 失败不发布半成品，清理目录并以 claim 限定失败写入', async (field) => {
    const s = await setup();
    let code = 'processing-failed';
    if (field === 'source') {
      s.storage.readSource.mockResolvedValue(Buffer.from('changed'));
      code = 'invalid-font';
    }
    if (field === 'descriptor')
      s.files.set('result.json', Buffer.from('{"manifest":{"sha256":"bad"}}'));
    if (field === 'manifest-hash') s.files.set(`${s.artifact.manifestSha}.json`, Buffer.from('{}'));
    if (field === 'asset-hash') s.files.set(`${s.artifact.specimenSha}.png`, Buffer.from('bad'));
    if (field === 'result-size') {
      jest.mocked(lstat).mockResolvedValue({ size: 4097 } as Awaited<ReturnType<typeof lstat>>);
      code = 'resource-limit';
    }
    if (field === 'sandbox') {
      s.sandbox.run.mockRejectedValue(new FontProcessingFailure('unsupported-font'));
      code = 'unsupported-font';
    }
    await expect(s.service.process(jobId, 1)).rejects.toMatchObject({ code });
    expect(s.tx.textFontVersion.create).not.toHaveBeenCalled();
    expect(s.work.remove).toHaveBeenCalledWith(s.ticket, true);
    expect(s.tx.textFontBuildJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: jobId,
        attempt: 1,
        claimToken: expect.stringMatching(/^[a-f0-9]{32}$/),
        status: 'PROCESSING',
      },
      data: {
        status: 'FAILED',
        claimToken: null,
        leaseExpiresAt: null,
        failureCode: code,
        failureReason: null,
      },
    });
  });
  it('构建身份漂移和授权缺失在创建工作目录前拒绝', async () => {
    const s = await setup();
    s.current().buildKey = 'wrong';
    await expect(s.service.process(jobId, 1)).rejects.toMatchObject({ code: 'processing-failed' });
    expect(s.work.create).not.toHaveBeenCalled();
    s.current().status = 'QUEUED';
    s.current().configuration.rights.redistribution = false;
    await expect(s.service.process(jobId, 1)).rejects.toMatchObject({ code: 'processing-failed' });
    expect(s.work.create).not.toHaveBeenCalled();
  });
  it('artifact 冲突和失败状态写入异常不泄露原始数据库错误', async () => {
    const s = await setup();
    s.tx.textFontArtifact.findUnique.mockResolvedValue(s.artifact);
    s.tx.textFontArtifact.upsert.mockResolvedValue({ ...s.artifact, manifestSha: 'different' });
    s.tx.textFontBuildJob.updateMany.mockRejectedValue(new Error('private-database-password'));
    await expect(s.service.process(jobId, 1)).rejects.toMatchObject({
      code: 'processing-failed',
      message: 'processing-failed',
    });
    expect(s.tx.textFontVersion.create).not.toHaveBeenCalled();
  });
});
