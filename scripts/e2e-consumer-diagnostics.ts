import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const prismaCodes = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2002',
  'P2003',
  'P2004',
  'P2010',
  'P2021',
  'P2022',
  'P2024',
  'P2025',
  'P2028',
  'P2034',
]);
const sqlStates = new Set([
  '40001',
  '40P01',
  '55P03',
  '57014',
  '25P02',
  '23503',
  '23505',
  '42501',
  '42P01',
  '42703',
  '53300',
  '57P01',
]);
const stages = new Set([
  'acquire',
  'configure',
  'interaction-lock',
  'management-lock',
  'read',
  'validate',
  'subthread',
  'font-policy',
  'body',
  'tags',
  'publish',
  'thread',
  'outbox',
  'usage',
  'commit',
]);
const errorTypes = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
  'BusinessException',
  'HttpException',
  'Error',
  'TypeError',
  'RangeError',
]);
const methods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']);

/** 只认过滤器结构化记录；忽略 message、堆栈、req/res、正文、SQL 和任意嵌套字段。 */
function collector(runId: string, exitCode: number | null) {
  const server: Array<Record<string, unknown>> = [],
    other: Array<Record<string, unknown>> = [];
  let count = 0,
    oversizedLines = 0;
  const push = (raw: string) => {
    if (raw.length > 65536) {
      oversizedLines++;
      return;
    }
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '');
    const start = line.indexOf('{');
    if (start < 0) return;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line.slice(start)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (
      !row ||
      row.context !== 'AllExceptionsFilter' ||
      !Number.isInteger(row.statusCode) ||
      Number(row.statusCode) < 400 ||
      Number(row.statusCode) > 599
    )
      return;
    const record = {
      statusCode: row.statusCode,
      method: typeof row.method === 'string' && methods.has(row.method) ? row.method : 'other',
      route: row.route === '/api/v1/threads/:id/aggregate' ? row.route : 'other',
      ...(typeof row.requestId === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.requestId)
        ? { requestId: row.requestId }
        : {}),
      errorType:
        typeof row.errorType === 'string' && errorTypes.has(row.errorType)
          ? row.errorType
          : 'UnknownError',
      ...(typeof row.prismaCode === 'string' && prismaCodes.has(row.prismaCode)
        ? { prismaCode: row.prismaCode }
        : {}),
      ...(typeof row.sqlState === 'string' && sqlStates.has(row.sqlState)
        ? { sqlState: row.sqlState }
        : {}),
      ...(row.dbOperation === 'thread.aggregate.save' ? { dbOperation: row.dbOperation } : {}),
      ...(typeof row.dbStage === 'string' && stages.has(row.dbStage)
        ? { dbStage: row.dbStage }
        : {}),
      ...(Number.isInteger(row.dbElapsedMs) &&
      Number(row.dbElapsedMs) >= 0 &&
      Number(row.dbElapsedMs) <= 86400000
        ? { dbElapsedMs: row.dbElapsedMs }
        : {}),
    };
    count++;
    const target = Number(record.statusCode) >= 500 ? server : other;
    target.push(record);
    if (target.length > 100) target.shift();
  };
  const result = () => {
    const remaining = 100 - server.length;
    const records = [...server, ...(remaining ? other.slice(-remaining) : [])];
    return {
      event: 'consumer-failed',
      runId: /^e2e_[a-f0-9]{24}$/.test(runId) ? runId : 'unknown',
      exitCode: Number.isInteger(exitCode) && exitCode! >= 0 && exitCode! <= 255 ? exitCode : null,
      omittedRecords: Math.max(0, count - records.length),
      oversizedLines,
      records,
    };
  };
  return { push, result };
}

export function consumerFailureDiagnostic(
  runId: string,
  exitCode: number | null,
  privateLog: string,
) {
  const collected = collector(runId, exitCode);
  for (const line of privateLog.split('\n')) collected.push(line);
  return collected.result();
}

export async function preserveConsumerDiagnostic(
  runId: string,
  exitCode: number | null,
  logPath: string,
  destination: string,
) {
  const collected = collector(runId, exitCode);
  const input = createReadStream(logPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) collected.push(line);
    writeFileSync(destination, JSON.stringify(collected.result(), null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  } finally {
    lines.close();
    input.destroy();
  }
}
