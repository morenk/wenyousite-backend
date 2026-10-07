/** 公开 E2E 诊断只含有限分类；私有异常正文始终留在本机 0600 日志。 */
const errorTypes = [
  'PrismaClientKnownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
  'AssertionError',
  'TypeError',
  'RangeError',
  'Error',
];
const errorCodes = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EIO',
  'ENOMEM',
  'EAGAIN',
  'ETIMEDOUT',
  'ERR_ASSERTION',
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND',
  'ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL',
  'ERR_PNPM_BAD_PM_VERSION',
  'ERR_PNPM_NO_GLOBAL_BIN_DIR',
  'ERR_PNPM_UNKNOWN_SHELL',
  'ERR_PNPM_UNSUPPORTED_ENGINE',
  'ERR_PNPM_FETCH_404',
  'ERR_PNPM_FETCH_401',
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1009',
  'P1010',
  'P1011',
  'P1012',
  'P1013',
  'P1014',
  'P1015',
  'P1016',
  'P1017',
  'P2002',
  'P2003',
  'P2010',
  'P2021',
  'P2022',
  'P2024',
  'P2025',
  'P2028',
  'P2034',
  'P3000',
  'P3005',
  'P3006',
  'P3009',
  'P3014',
  'P3018',
  'P3021',
  '28000',
  '28P01',
  '3D000',
  '3F000',
  '42501',
  '42P01',
  '42703',
  '42883',
  '23505',
  '23503',
  '40P01',
  '40001',
  '55P03',
  '57014',
]);

export function suiteFailureDiagnostic(
  runId: string,
  script: string,
  exitCode: number | null,
  privateLog: string,
  allowedScripts: ReadonlySet<string>,
) {
  const safeScript =
    allowedScripts.has(script) && /^[a-z0-9][a-z0-9.-]*\.ts$/.test(script) ? script : 'unknown';
  const text = privateLog.slice(-131072).replace(/\u001b\[[0-9;]*m/g, '');
  const candidates: string[] =
    text.match(/\b(?:ERR_[A-Z0-9_]+|MODULE_NOT_FOUND|E[A-Z]+|P\d{4})\b/g) ?? [];
  for (const match of text.matchAll(
    /\b(?:SQLSTATE|Database error code|code)\s*[:=]\s*["']?([0-9A-Z]{5})\b/g,
  ))
    candidates.push(match[1]);
  const codes = [...new Set(candidates.filter((code) => errorCodes.has(code)))].slice(0, 4);
  const errorType =
    errorTypes.find((name) => new RegExp(`\\b${name}\\b`).test(text)) ?? 'UnknownError';
  const category = /\bERR_PNPM_[A-Z0-9_]+\b/.test(text)
    ? 'package-manager'
    : /\bspawn(?:Sync)?\b/.test(text) &&
        codes.some((code) => ['ENOENT', 'EACCES', 'EPERM'].includes(code))
      ? 'process-start'
      : /\bPrismaClient\w*Error\b/.test(text) || codes.some((code) => /^P\d{4}$/.test(code))
        ? 'prisma'
        : /\b(?:SQLSTATE|Database error code)\b/.test(text)
          ? 'postgresql'
          : errorType === 'AssertionError'
            ? 'assertion'
            : 'unclassified';
  const source: Array<{ line: number; column: number }> = [];
  if (safeScript !== 'unknown') {
    const escaped = safeScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of text.matchAll(
      new RegExp(`(?:^|[/\\\\\\s(])${escaped}:(\\d{1,6}):(\\d{1,6})\\b`, 'gm'),
    )) {
      const line = Number(match[1]),
        column = Number(match[2]);
      if (
        line > 0 &&
        column > 0 &&
        !source.some((frame) => frame.line === line && frame.column === column)
      )
        source.push({ line, column });
      if (source.length === 3) break;
    }
  }
  return {
    event: 'suite-failed',
    runId: /^e2e_[a-f0-9]{24}$/.test(runId) ? runId : 'unknown',
    script: safeScript,
    exitCode: Number.isInteger(exitCode) && exitCode! >= 0 && exitCode! <= 255 ? exitCode : null,
    category,
    errorType,
    codes,
    source,
  };
}

type Identity = { runId: string; root: string; uid: number | undefined };
type Verified = { pgPort: number; redisPort: number; redisInstance: string };
export function resourceDiagnostic(
  event: 'resources-verified' | 'resources-cleaned',
  identity: Identity,
  verified?: Verified,
) {
  return {
    event,
    runId: identity.runId,
    uid: identity.uid,
    root: identity.root,
    ...(verified
      ? {
          pgPort: verified.pgPort,
          redisPort: verified.redisPort,
          redisInstance: verified.redisInstance,
        }
      : {}),
    ...(event === 'resources-cleaned'
      ? { resourcesCleaned: true, resourcesVerified: Boolean(verified) }
      : {}),
  };
}
