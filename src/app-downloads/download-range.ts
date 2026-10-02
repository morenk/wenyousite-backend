import { DownloadFailure } from './download-model';

export function selectRange(
  value: string | undefined,
  size: number,
  ifRange?: string,
  etag?: string,
  modified?: string,
) {
  const full = { start: 0, end: size - 1, length: size, partial: false };
  if (!value) return full;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new DownloadFailure(416);
  const left = match[1] ? Number(match[1]) : undefined;
  const right = match[2] ? Number(match[2]) : undefined;
  if ([left, right].some((n) => n !== undefined && !Number.isSafeInteger(n)))
    throw new DownloadFailure(416);
  if (left === undefined && (!right || right < 1)) throw new DownloadFailure(416);
  if (left !== undefined && (left >= size || (right !== undefined && right < left)))
    throw new DownloadFailure(416);
  const start = left ?? Math.max(0, size - right!);
  const end = left === undefined ? size - 1 : Math.min(right ?? size - 1, size - 1);
  if (ifRange && ifRange !== etag && ifRange !== modified) return full;
  return { start, end, length: end - start + 1, partial: true };
}
