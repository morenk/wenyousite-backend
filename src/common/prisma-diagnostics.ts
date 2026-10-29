import { Prisma } from '@prisma/client';

const PRISMA_CODES = new Set([
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
const SQL_STATES = new Set([
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
export type AggregateStage =
  | 'acquire'
  | 'configure'
  | 'interaction-lock'
  | 'management-lock'
  | 'read'
  | 'validate'
  | 'subthread'
  | 'font-policy'
  | 'body'
  | 'tags'
  | 'publish'
  | 'thread'
  | 'outbox'
  | 'usage'
  | 'commit';
type Context = {
  dbOperation?: 'thread.aggregate.save';
  dbStage?: AggregateStage;
  dbElapsedMs?: number;
  prismaCode?: string;
  sqlState?: string;
};
const contexts = new WeakMap<object, Context>();

export function recordAggregateFailure(
  error: unknown,
  stage: AggregateStage,
  startedAt: number,
): void {
  if (error && typeof error === 'object')
    contexts.set(error, {
      dbOperation: 'thread.aggregate.save',
      dbStage: stage,
      dbElapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
}
function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && 'value' in property ? property.value : undefined;
}
/** 只读取精确白名单字段，不序列化 message/meta/cause，也不调用异常 getter。 */
export function prismaDiagnostics(error: unknown) {
  const context = error && typeof error === 'object' ? contexts.get(error) : undefined;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return { ...context };
  const code = ownValue(error, 'code');
  const state = code === 'P2010' ? ownValue(ownValue(error, 'meta'), 'code') : undefined;
  return {
    ...context,
    ...(typeof code === 'string' && PRISMA_CODES.has(code) ? { prismaCode: code } : {}),
    ...(typeof state === 'string' && SQL_STATES.has(state) ? { sqlState: state } : {}),
  };
}

export function copyPrismaDiagnostics(source: unknown, target: object): void {
  contexts.set(target, prismaDiagnostics(source));
}

const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;

/** Prisma message 可多行；只保留受控模块名及数字位置，不输出函数名或异常提供的路径。 */
export function safeErrorFrames(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'stack');
  const stack: unknown =
    descriptor && 'value' in descriptor
      ? descriptor.value
      : nativeStackGetter && descriptor?.get === nativeStackGetter
        ? nativeStackGetter.call(error)
        : undefined;
  if (typeof stack !== 'string') return undefined;
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    const match = line.match(
      /^\s+at (?:async )?(?:[\w.$<>]+(?: \[as [\w$]+\])? \()?[^\s()]*\/(src|dist)\/([a-z0-9_./-]+\.(?:ts|js)):(\d{1,6}):(\d{1,6})\)?$/i,
    );
    if (match) {
      const file = /^threads\/thread-aggregate\.service\.(?:ts|js)$/.test(match[2])
        ? 'thread-aggregate.service'
        : 'application';
      frames.push(`    at ${file}:${match[3]}:${match[4]}`);
    }
    if (frames.length === 8) break;
  }
  return frames.join('\n');
}
