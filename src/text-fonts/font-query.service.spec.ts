import { PrismaService } from '../prisma/prisma.service';
import { FontQueryService } from './font-query.service';
import { FontStorageService } from './font-storage.service';

const id = 'tfv_' + 'a'.repeat(32);
const asset = { sha256: 'b'.repeat(64), bytes: 4, format: 'ttf' };
function setup() {
  const version = {
    id,
    artifactKey: 'build',
    publishedAt: new Date(),
    withdrawnAt: null as Date | null,
    artifact: { assets: [asset] },
  };
  const findUnique = jest.fn().mockImplementation(async () => ({ ...version }));
  const tx = { $queryRaw: jest.fn(), textFontVersion: { findUnique } };
  const transaction = jest.fn(async (body: (value: typeof tx) => Promise<void>) => body(tx));
  const readAsset = jest.fn().mockResolvedValue(Buffer.from('font'));
  const service = new FontQueryService(
    { textFontVersion: { findUnique }, $transaction: transaction } as unknown as PrismaService,
    { requireConfigured: jest.fn(), readAsset } as unknown as FontStorageService,
  );
  return { version, transaction, readAsset, service };
}

describe('版本资产在远端读取后重新核验撤回', () => {
  it('慢存储不占字体状态事务，读取期间撤回不能返回字节', async () => {
    const { service, version, transaction, readAsset } = setup();
    let resolve!: (value: Buffer) => void;
    readAsset.mockImplementation(
      () =>
        new Promise<Buffer>((done) => {
          resolve = done;
        }),
    );
    const reading = service.asset(id, asset.sha256 + '.ttf');
    await Promise.resolve();
    expect(readAsset).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    version.withdrawnAt = new Date();
    resolve(Buffer.from('font'));
    await expect(reading).rejects.toMatchObject({ status: 410 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('已撤回、未发布或不属于版本的对象在下载前拒绝', async () => {
    const { service, version, readAsset } = setup();
    await expect(service.asset(id, 'c'.repeat(64) + '.ttf')).rejects.toMatchObject({ status: 404 });
    version.withdrawnAt = new Date();
    await expect(service.asset(id, asset.sha256 + '.ttf')).rejects.toMatchObject({ status: 410 });
    expect(readAsset).not.toHaveBeenCalled();
  });

  it('存储损坏映射固定 503，不暴露对象位置或内部错误', async () => {
    const { service, readAsset } = setup();
    readAsset.mockRejectedValue(new Error('https://private.invalid/secret'));
    await expect(service.asset(id, asset.sha256 + '.ttf')).rejects.toMatchObject({
      status: 503,
      message: '字体资源暂不可用，请稍后重试',
    });
  });
});
