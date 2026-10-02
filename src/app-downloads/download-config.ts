import { z } from 'zod';
import { parse } from 'dotenv';
import { isAbsolute, join } from 'node:path';
import { safeOpen } from './download-files';
import { DOWNLOAD_LIMITS } from './app-download.contract';
import { assertDownload } from './download-model';

const pathSchema = z.string().refine((p) => isAbsolute(p) && !p.includes('\0') && p.length < 512);
const configSchema = z
  .object({
    DOWNLOAD_SOCKET: pathSchema,
    DOWNLOAD_CACHE_DIR: pathSchema,
    DOWNLOAD_CATALOG_DIR: pathSchema,
    DOWNLOAD_EGRESS_DIR: pathSchema,
    DOWNLOAD_ORIGIN_DIR: pathSchema,
    DOWNLOAD_DAY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(1024 ** 4)
      .optional(),
    DOWNLOAD_MONTH_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(12 * 1024 ** 4)
      .optional(),
    DOWNLOAD_ORIGIN_DAY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(1024 ** 4)
      .optional(),
    DOWNLOAD_ORIGIN_MONTH_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(12 * 1024 ** 4)
      .optional(),
  })
  .strict();
export type DownloadConfig = z.infer<typeof configSchema>;
export async function loadDownloadConfig(path: string) {
  return configSchema.parse(await loadEnvironmentFile(path));
}
export async function loadEnvironmentFile(path: string) {
  const file = await safeOpen(path);
  try {
    const stat = await file.stat();
    assertDownload(stat.size < 16384 && (stat.mode & 0o007) === 0);
    const text = await file.readFile('utf8');
    const keys = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    assertDownload(new Set(keys).size === keys.length);
    return parse(text);
  } finally {
    await file.close();
  }
}
export const ledgerPath = (config: DownloadConfig, kind: 'egress' | 'origin') =>
  join(
    kind === 'egress' ? config.DOWNLOAD_EGRESS_DIR : config.DOWNLOAD_ORIGIN_DIR,
    'budget.sqlite',
  );

export function downloadBudgetLimits(config: DownloadConfig, kind: 'egress' | 'origin') {
  return kind === 'egress'
    ? {
        day: config.DOWNLOAD_DAY_BYTES ?? DOWNLOAD_LIMITS.outboundDayBytes,
        month: config.DOWNLOAD_MONTH_BYTES ?? DOWNLOAD_LIMITS.outboundMonthBytes,
      }
    : {
        day: config.DOWNLOAD_ORIGIN_DAY_BYTES ?? DOWNLOAD_LIMITS.originDayBytes,
        month: config.DOWNLOAD_ORIGIN_MONTH_BYTES ?? DOWNLOAD_LIMITS.originMonthBytes,
      };
}
