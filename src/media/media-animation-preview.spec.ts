
jest.mock('node:child_process', () => ({ ...jest.requireActual('node:child_process'), execFile: jest.fn() }));
jest.mock('node:fs/promises', () => ({ ...jest.requireActual('node:fs/promises'), readFile: jest.fn().mockResolvedValue('VmRSS: 100 kB') }));
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { generateAnimationPreviews } from './media-animation-preview';

describe('编码子进程边界与槽等待', () => {
  const launch = execFile as unknown as jest.Mock;
  let done: (error: Error | null, output: Buffer) => void;
  const child = { pid: 123, kill: jest.fn(), stdin: { on: jest.fn(), end: jest.fn() } };
  beforeEach(() => {
    jest.useFakeTimers({ now: 100_000 }); jest.clearAllMocks();
    jest.mocked(readFile).mockResolvedValue('VmRSS: 100 kB');
    launch.mockImplementation((_path, _args, _options, callback) => { done = callback; return child; });
  });
  afterEach(() => jest.useRealTimers());

  it('等待槽位计入自己的截止时间，不启动第二进程；第一进程硬超时后释放槽', async () => {
    const first = generateAnimationPreviews(Buffer.alloc(100), Date.now() + 8_000);
    await jest.advanceTimersByTimeAsync(0);
    const second = generateAnimationPreviews(Buffer.alloc(100), Date.now() + 1_000);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await second).toEqual([]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: 8_000, killSignal: 'SIGKILL', maxBuffer: 8_392 }));
    done(new Error('timeout killed'), Buffer.alloc(0));
    expect(await first).toEqual([]);
    const third = generateAnimationPreviews(Buffer.alloc(100), Date.now() + 2_000);
    await jest.advanceTimersByTimeAsync(0);
    expect(launch).toHaveBeenCalledTimes(2);
    done(null, Buffer.alloc(0));
    await third;
  });
  it('RSS 超限杀死进程；不把数据库或对象存储环境传入子进程', async () => {
    jest.mocked(readFile).mockResolvedValue('VmRSS: 600000 kB');
    const result = generateAnimationPreviews(Buffer.alloc(100), Date.now() + 8_000);
    await jest.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(launch.mock.calls[0][2].env).toEqual({ NODE_ENV: 'production', VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' });
    done(new Error('memory killed'), Buffer.alloc(0));
    expect(await result).toEqual([]);
  });
  it('损坏或越界子进程输出丢弃，输入超限不启动', async () => {
    const result = generateAnimationPreviews(Buffer.alloc(100), Date.now() + 8_000);
    await jest.advanceTimersByTimeAsync(0);
    const header = Buffer.from(JSON.stringify([{ edge: 480, width: 9999, height: 1, bytes: 1 }]));
    const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
    done(null, Buffer.concat([size, header, Buffer.alloc(1)]));
    expect(await result).toEqual([]);
    expect(await generateAnimationPreviews(Buffer.alloc(10 * 1024 * 1024 + 1), Date.now() + 8_000)).toEqual([]);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
