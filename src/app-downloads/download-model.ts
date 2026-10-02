import { z } from 'zod';
import { ANDROID_APPLICATION_ID, DOWNLOAD_LIMITS, downloadUrl } from './app-download.contract';

export const artifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: z.literal(ANDROID_APPLICATION_ID),
    versionName: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/),
    buildNumber: z.number().int().min(1).max(2100000000),
    sizeBytes: z.number().int().min(1).max(DOWNLOAD_LIMITS.maxArtifactBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bucket: z.literal('wenyou-apk'),
    key: z.string(),
    legacyUpdateUrl: z.string(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const key = `mobile/android/wenyou-${a.versionName}-${a.buildNumber}.apk`;
    if (a.key !== key || a.legacyUpdateUrl !== `https://wenyou-apk.cn-nb1.rains3.com/${key}`)
      ctx.addIssue({ code: 'custom', message: 'INVALID_ARTIFACT_LOCATION' });
  });
export type Artifact = z.infer<typeof artifactSchema>;
export const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: z.enum(['available', 'no_release', 'withdrawn', 'paused']),
    recommendedBuild: z.number().int().positive().nullable(),
    artifacts: z
      .array(
        z
          .object({
            artifact: artifactSchema,
            publishedAt: z.iso.datetime().nullable(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((c, ctx) => {
    const builds = c.artifacts.map((a) => a.artifact.buildNumber);
    if (
      new Set(builds).size !== builds.length ||
      (c.recommendedBuild !== null &&
        !c.artifacts.some((a) => a.artifact.buildNumber === c.recommendedBuild && a.publishedAt))
    )
      ctx.addIssue({ code: 'custom', message: 'INVALID_CATALOG' });
  });
export type Catalog = z.infer<typeof catalogSchema>;
export function fileName(a: Artifact) {
  return `wenyou-${a.versionName}-${a.buildNumber}.apk`;
}
export function publicInfo(a: Artifact, publishedAt: string) {
  return {
    platform: 'android' as const,
    applicationId: a.applicationId,
    versionName: a.versionName,
    buildNumber: a.buildNumber,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    fileName: fileName(a),
    publishedAt,
    downloadUrl: downloadUrl(a.buildNumber),
    releaseNotesUrl: `https://wenyou.site/api/v1/mobile-releases/android/${a.buildNumber}`,
  };
}
export class DownloadFailure extends Error {
  constructor(
    readonly status: 404 | 416 | 429 | 503,
    readonly retryAfter?: number,
    readonly reason: 'request_rate' | 'concurrency' | 'budget' | 'unavailable' = 'unavailable',
  ) {
    super('DOWNLOAD_UNAVAILABLE');
  }
}
export function assertDownload(value: unknown): asserts value {
  if (!value) throw new DownloadFailure(503);
}
