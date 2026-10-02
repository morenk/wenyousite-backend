import { createHmac, timingSafeEqual } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
export type DiscussionCursorContext = {
  scope: 'floors' | 'replies';
  scopeId: string;
  order: string;
  authorId: string | null;
  viewerId: string | null;
};
export type DiscussionCursor = DiscussionCursorContext & {
  version: 1;
  number: number;
  direction: 'before' | 'after';
};
export function invalidDiscussionCursor(): never {
  throw new BusinessException(ErrorCode.INVALID_CURSOR, '定位游标无效，请重新定位');
}
export function encodeDiscussionCursor(value: DiscussionCursor, secret: string): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return (
    body +
    '.' +
    createHmac('sha256', secret)
      .update('discussion-v1:' + body)
      .digest('base64url')
  );
}
export function decodeDiscussionCursor(
  value: string,
  context: DiscussionCursorContext,
  secret: string,
): DiscussionCursor {
  try {
    if (value.length > 2048) return invalidDiscussionCursor();
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra) return invalidDiscussionCursor();
    const expected = createHmac('sha256', secret)
      .update('discussion-v1:' + body)
      .digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return invalidDiscussionCursor();
    const result = JSON.parse(Buffer.from(body, 'base64url').toString()) as DiscussionCursor;
    if (
      result.version !== 1 ||
      !Number.isSafeInteger(result.number) ||
      result.number < 1 ||
      !['before', 'after'].includes(result.direction) ||
      Object.entries(context).some(
        ([key, field]) => result[key as keyof DiscussionCursor] !== field,
      )
    )
      return invalidDiscussionCursor();
    return result;
  } catch {
    return invalidDiscussionCursor();
  }
}
