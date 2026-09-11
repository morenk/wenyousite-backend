
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EncodedPreview, PREVIEW_EDGES, PREVIEW_MAX_INPUT_BYTES, PREVIEW_MAX_RSS_BYTES,
} from './media-animation-preview-policy';

import { withMediaEncodingSlot } from './media-encoding-slot';

function parseOutput(output: Buffer, sourceBytes: number): EncodedPreview[] {
  if (output.length < 4) return [];
  const headerLength = output.readUInt32BE();
  if (headerLength > 4096 || 4 + headerLength > output.length) return [];
  const descriptors: unknown = JSON.parse(output.subarray(4, 4 + headerLength).toString());
  if (!Array.isArray(descriptors) || descriptors.length > 2) return [];
  let offset = 4 + headerLength;
  const result: EncodedPreview[] = [];
  for (const item of descriptors) {
    if (!PREVIEW_EDGES.includes(item.edge) ||
      ![item.width, item.height, item.bytes].every((n) => Number.isSafeInteger(n) && n > 0) ||
      item.bytes >= sourceBytes || Math.max(item.width, item.height) > item.edge ||
      offset + item.bytes > output.length) return [];
    result.push({ edge: item.edge, width: item.width, height: item.height,
      body: output.subarray(offset, offset + item.bytes) });
    offset += item.bytes;
  }
  return offset === output.length ? result : [];
}

async function runChild(source: Buffer, deadline: number): Promise<EncodedPreview[]> {
  const remaining = deadline - Date.now();
  if (remaining < 500) return [];
  return new Promise((resolve) => {
    const isTypeScript = __filename.endsWith('.ts');
    const args = ['--max-old-space-size=96', ...(isTypeScript ? ['--import', 'tsx'] : []),
      join(__dirname, 'media-animation-preview.worker.' + (isTypeScript ? 'ts' : 'js'))];
    let monitor: ReturnType<typeof setInterval> | undefined;
    const child = execFile(process.execPath, args, {
      timeout: remaining, killSignal: 'SIGKILL', maxBuffer: source.length * 2 + 8192,
      encoding: 'buffer',
      env: { NODE_ENV: 'production', VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' },
    }, (error, stdout) => {
      if (monitor) clearInterval(monitor);
      if (error || Date.now() >= deadline) return resolve([]);
      try { resolve(parseOutput(stdout, source.length)); } catch { resolve([]); }
    });
    // V8 堆限制不包含 libvips 原生内存，额外监测 RSS；像素预算是分配前的第一道约束。
    if (process.platform === 'linux') {
      monitor = setInterval(() => {
        void readFile('/proc/' + child.pid + '/status', 'utf8').then((status) => {
          const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] ?? 0) * 1024;
          if (rss > PREVIEW_MAX_RSS_BYTES) child.kill('SIGKILL');
        }).catch(() => undefined);
      }, 50);
      monitor.unref();
    }
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(source);
  });
}

/** 一个图片 Worker 同时只运行一个预览编码子进程，等待与两档编码共用截止时间。 */
export async function generateAnimationPreviews(source: Buffer, deadline: number): Promise<EncodedPreview[]> {
  if (source.length > PREVIEW_MAX_INPUT_BYTES || deadline <= Date.now()) return [];
  try { return await withMediaEncodingSlot(deadline, () => runChild(source, deadline)); }
  catch { return []; }
}
