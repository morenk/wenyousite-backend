import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export function eligibleIdentity(
  ownerId: string,
  userId: string,
  member: { role: string; playerMarked: boolean } | null,
): boolean {
  return (
    ownerId === userId ||
    member?.role === 'OWNER' ||
    member?.role === 'COLLABORATOR' ||
    member?.playerMarked === true
  );
}
export function identityToken(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function assertIdentityToken(
  expected: string | undefined,
  actual: string,
  usingIdentity: boolean,
  mode?: 'ACCOUNT' | 'RP',
) {
  if (mode === 'ACCOUNT') return;
  if (
    (mode === 'RP' && !usingIdentity) ||
    (expected !== undefined && expected !== actual) ||
    (expected === undefined && usingIdentity)
  ) {
    throw new BusinessException(
      ErrorCode.RP_IDENTITY_CHANGED,
      '发言身份已变化，请保留草稿，重新确认发言身份',
      HttpStatus.CONFLICT,
    );
  }
}
export type IdentitySnapshot = { id: string; nickname: string; avatar: string | null };
export type MentionSnapshot = { userId: string; label: string; identityId: string | null; sourceHref?: string; targetIdentityId?: string | null };
export function readIdentity(value: unknown): IdentitySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' &&
    typeof row.nickname === 'string' &&
    (row.avatar === null || typeof row.avatar === 'string')
    ? { id: row.id, nickname: row.nickname, avatar: row.avatar }
    : null;
}
export function readMentions(value: unknown): MentionSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is MentionSnapshot =>
    Boolean(
      row &&
      typeof row === 'object' &&
      typeof row.userId === 'string' &&
      typeof row.label === 'string' &&
      (row.identityId === null || typeof row.identityId === 'string'),
    ),
  );
}
/** 标准 Markdown 提及保持原始标签；代码/转义内容不产生身份语义。 */
export function canonicalMentions(content: string): Array<{ userId: string; label: string }> {
  const masked = content
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, (value) =>
      ' '.repeat(value.length),
    )
    .replace(/(`+)(?!`)[^\n]*?\1(?!`)/g, (value) => ' '.repeat(value.length));
  return [...masked.matchAll(/\[@([^\]\r\n]{1,32})\]\(\/users\/([a-zA-Z0-9_-]+)\)/g)]
    .filter((match) => {
      let slashes = 0;
      for (let i = match.index! - 1; i >= 0 && content[i] === '\\'; i--) slashes++;
      return slashes % 2 === 0;
    })
    .map((match) => ({ label: match[1], userId: match[2] }));
}
