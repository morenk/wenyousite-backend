jest.mock('node:child_process', () => ({ ...jest.requireActual('node:child_process'), execFile: jest.fn() }));
jest.mock('node:fs/promises', () => ({ ...jest.requireActual('node:fs/promises'), readFile: jest.fn() }));
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { generateAnimationDisplay } from './media-animation-display';
import { generateAnimationPreviews } from './media-animation-preview';

function output(change: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ width: 10, height: 20, bytes: 1, frameCount: 2, durationMs: 200, loopCount: 0, ...change }));
  const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
  return Buffer.concat([size, header, Buffer.alloc(1)]);
}
describe('完整编码隔离资源与IPC拒绝路径', () => {
  const launch = execFile as unknown as jest.Mock;
  const child = { pid: 123, kill: jest.fn(), stdin: { on: jest.fn(), end: jest.fn() } };
  let done: (error: Error | null, output: Buffer) => void;
  beforeEach(() => {
    jest.useFakeTimers({ now: 100_000 }); jest.clearAllMocks();
    jest.mocked(readFile).mockResolvedValue('VmRSS: 100 kB');
    launch.mockImplementation((_path, _args, _options, callback) => { done = callback; return child; });
  });
  afterEach(() => jest.useRealTimers());
  it('full与preview共享一编码槽，等待超时不能启动第二进程，结束后槽可复用', async () => {
    const full = generateAnimationDisplay(Buffer.alloc(100)); await jest.advanceTimersByTimeAsync(0);
    const preview = generateAnimationPreviews(Buffer.alloc(100), Date.now() + 1000);
    await jest.advanceTimersByTimeAsync(1000); expect(await preview).toEqual([]); expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][2]).toMatchObject({ timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 + 8192 });
    done(null, output()); expect((await full).frameCount).toBe(2);
    const next = generateAnimationDisplay(Buffer.alloc(100)); await jest.advanceTimersByTimeAsync(0); done(null, output()); await next;
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it('RSS超限硬杀且只传无密钥白名单环境；OS超时或输出超限明确失败', async () => {
    jest.mocked(readFile).mockResolvedValue('VmRSS: 600000 kB');
    const result = generateAnimationDisplay(Buffer.alloc(100)); const failed = expect(result).rejects.toThrow('DISPLAY_ENCODING_FAILED');
    await jest.advanceTimersByTimeAsync(50); expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(launch.mock.calls[0][2].env).toEqual({ NODE_ENV: 'production', VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' });
    done(new Error('SIGKILL'), Buffer.alloc(0)); await failed;
  });
  it.each([{ width: 0 }, { bytes: 2 }, { bytes: 40 * 1024 * 1024 }, { frameCount: 0 }, { loopCount: -1 }])('拒绝IPC虚假尺寸/长度/循环 %j', async (change) => {
    const result = generateAnimationDisplay(Buffer.alloc(100)); const failed = expect(result).rejects.toThrow('DISPLAY_ENCODING_PROTOCOL_INVALID');
    await jest.advanceTimersByTimeAsync(0); done(null, output(change)); await failed;
  });
  it('截短或超长头不能越界分配', async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from([0, 0, 32, 0])]) {
      const result = generateAnimationDisplay(Buffer.alloc(1)); const failed = expect(result).rejects.toThrow('DISPLAY_ENCODING_PROTOCOL_INVALID');
      await jest.advanceTimersByTimeAsync(0); done(null, bytes); await failed;
    }
  });
});
