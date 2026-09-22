import { createHmac, timingSafeEqual } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { GalleryScope } from './gallery.dto';
import { ReplyOrder } from '../common/dto/reply-query.dto';
export type GallerySession = {
  scope: GalleryScope;
  scopeId: string;
  order: ReplyOrder;
  authorId: string | null;
  viewerId: string | null;
  snapshot: number;
  snapshotTx: string;
  pinnedIds: string[];
};
export type GalleryBoundary = {
  sourceId: string;
  sourceVersion: number;
  imageIndex: number;
  groupKey: number;
  timeKey: number;
};
export type GalleryCursor = {
  version: 1;
  session: GallerySession;
  boundary: GalleryBoundary;
  direction: 'before' | 'after';
};
export function invalidCursor(): never {
  throw new BusinessException(ErrorCode.INVALID_CURSOR, '图片浏览游标无效，请重新打开');
}
export function encodeGalleryCursor(value: GalleryCursor, secret: string): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return (
    body +
    '.' +
    createHmac('sha256', secret)
      .update('gallery-v1:' + body)
      .digest('base64url')
  );
}
export function decodeGalleryCursor(value: string, secret: string): GalleryCursor {
  try {
    const [body, signature, extra] = value.split('.');
    if (extra || !body || !signature) return invalidCursor();
    const expected = createHmac('sha256', secret)
      .update('gallery-v1:' + body)
      .digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return invalidCursor();
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GalleryCursor;
    if (
      parsed.version !== 1 ||
      !parsed.session ||
      !parsed.boundary ||
      !['before', 'after'].includes(parsed.direction) ||
      !Number.isSafeInteger(parsed.session.snapshot) ||
      typeof parsed.session.snapshotTx !== 'string' ||
      parsed.session.snapshotTx.length > 2048 ||
      parsed.session.snapshot > Date.now() ||
      Date.now() - parsed.session.snapshot > 24 * 60 * 60 * 1000
    )
      return invalidCursor();
    return parsed;
  } catch {
    return invalidCursor();
  }
}
