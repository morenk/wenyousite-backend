import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DISPLAY_ENCODING_MS, DISPLAY_MAX_INPUT_BYTES, DISPLAY_MAX_OUTPUT_BYTES, DISPLAY_MAX_RSS_BYTES } from './media-animation-display-policy';
import { readMediaDisplay } from './media-display';
import { withMediaEncodingSlot } from './media-encoding-slot';

export async function generateAnimationDisplay(source: Buffer, mode: 'media' | 'sticker' = 'media', budgetMs = DISPLAY_ENCODING_MS) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > DISPLAY_ENCODING_MS) throw new Error('DISPLAY_BUDGET_INVALID');
  if (source.length > DISPLAY_MAX_INPUT_BYTES) throw new Error('DISPLAY_INPUT_LIMIT');
  const deadline = Date.now() + budgetMs;
  return withMediaEncodingSlot(deadline, () => new Promise<{
    body: Buffer; width: number; height: number; frameCount: number; durationMs: number; loopCount: number;
  }>((resolve, reject) => {
    const isTypeScript = __filename.endsWith('.ts');
    const args = ['--max-old-space-size=96', ...(isTypeScript ? ['--import', 'tsx'] : []),
      join(__dirname, 'media-animation-display.worker.' + (isTypeScript ? 'ts' : 'js')),
      ...(mode === 'sticker' ? ['--sticker'] : [])];
    let monitor: ReturnType<typeof setInterval> | undefined;
    const child = execFile(process.execPath, args, {
      timeout: Math.max(1, deadline - Date.now()), killSignal: 'SIGKILL',
      maxBuffer: DISPLAY_MAX_OUTPUT_BYTES + 8192, encoding: 'buffer',
      env: { NODE_ENV: 'production', VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' },
    }, (error, stdout, stderr) => {
      if (monitor) clearInterval(monitor);
      if (error || Date.now() >= deadline) {
        const code = stderr?.toString().trim();
        return reject(new Error(code && /^(DISPLAY|IMAGE|GIF|ANIMATED_IMAGE)_[A-Z_]{1,64}$/.test(code) ? code : 'DISPLAY_ENCODING_FAILED'));
      }
      try {
        const length = stdout.readUInt32BE();
        if (length > 4096 || length + 4 > stdout.length) throw new Error();
        const meta = JSON.parse(stdout.subarray(4, 4 + length).toString());
        const body = stdout.subarray(4 + length);
        const checked = readMediaDisplay({ ...meta, url: 'https://display.invalid/validated.webp',
          contentType: 'image/webp', animated: meta.frameCount > 1 });
        if (!checked || body.length !== checked.bytes || body.length > DISPLAY_MAX_OUTPUT_BYTES) throw new Error();
        resolve({ body, width: checked.width, height: checked.height, frameCount: checked.frameCount,
          durationMs: checked.durationMs, loopCount: checked.loopCount });
      } catch { reject(new Error('DISPLAY_ENCODING_PROTOCOL_INVALID')); }
    });
    if (process.platform === 'linux') {
      monitor = setInterval(() => {
        void readFile('/proc/' + child.pid + '/status', 'utf8').then((status) => {
          const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] ?? 0) * 1024;
          if (rss > DISPLAY_MAX_RSS_BYTES) child.kill('SIGKILL');
        }).catch(() => undefined);
      }, 50);
      monitor.unref();
    }
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(source);
  }));
}
