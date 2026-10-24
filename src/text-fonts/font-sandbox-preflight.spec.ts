import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { runFontSandboxPreflight } from './font-sandbox-preflight';
import { FontSandboxService } from './font-sandbox.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  mkdtemp: jest.fn(),
  open: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
  writeFile: jest.fn(),
}));
jest.mock('./font-sandbox.service');

describe('字体启动前沙箱预检', () => {
  const status =
    'NoNewPrivs:\t1\nCapEff:\t0000\nCapPrm:\t0000\nCapInh:\t0000\nCapAmb:\t0000\nCapBnd:\t0000\n';
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(process, 'getuid').mockReturnValue(996);
    jest.mocked(readFile).mockResolvedValueOnce(status).mockResolvedValue('{"passed":true}');
    jest.mocked(open).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    jest.mocked(mkdtemp).mockResolvedValue('/synthetic/root/sandbox-preflight-unique');
    jest.mocked(FontSandboxService.prototype.run).mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  it('仅在独立临时目录执行可信探针并完成清理', async () => {
    await runFontSandboxPreflight('/synthetic/root', '/synthetic/toolchain');
    expect(mkdtemp).toHaveBeenCalledWith('/synthetic/root/sandbox-preflight-');
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(FontSandboxService.prototype.run).toHaveBeenCalledWith(
      '/synthetic/root/sandbox-preflight-unique/input',
      '/synthetic/root/sandbox-preflight-unique/output',
      expect.objectContaining({ wallMs: 15000 }),
    );
    expect(rm).toHaveBeenCalledWith('/synthetic/root/sandbox-preflight-unique', {
      recursive: true,
    });
  });

  it('沙箱失败仍清理且拒绝启动', async () => {
    jest
      .mocked(FontSandboxService.prototype.run)
      .mockRejectedValue(new Error('sandbox-unavailable'));
    await expect(
      runFontSandboxPreflight('/synthetic/root', '/synthetic/toolchain'),
    ).rejects.toThrow('sandbox-unavailable');
    expect(FontSandboxService.prototype.onModuleDestroy).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledTimes(1);
  });

  it('清理失败不能计为预检通过', async () => {
    jest.mocked(rm).mockRejectedValue(new Error('cleanup-failed'));
    await expect(
      runFontSandboxPreflight('/synthetic/root', '/synthetic/toolchain'),
    ).rejects.toThrow('cleanup-failed');
  });

  it.each(['CapBnd:\t0001', 'NoNewPrivs:\t0'])('拒绝外层权限退化: %s', async (replacement) => {
    jest
      .mocked(readFile)
      .mockReset()
      .mockResolvedValue(
        status.replace(new RegExp(`${replacement.split(':')[0]}:.*`), replacement),
      );
    await expect(
      runFontSandboxPreflight('/synthetic/root', '/synthetic/toolchain'),
    ).rejects.toThrow();
    expect(mkdtemp).not.toHaveBeenCalled();
  });

  it('宿主内核资源可打开时拒绝继续', async () => {
    const close = jest.fn();
    jest.mocked(open).mockResolvedValue({ close } as unknown as Awaited<ReturnType<typeof open>>);
    await expect(
      runFontSandboxPreflight('/synthetic/root', '/synthetic/toolchain'),
    ).rejects.toThrow();
    expect(close).toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
  });
});
