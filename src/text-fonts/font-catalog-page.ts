import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import {
  FontCatalogEntryDto,
  FontCatalogPageDto,
  FontCatalogQueryDto,
} from './dto/font-public.dto';

export const FONT_METADATA_MAX_BYTES = 65536;
export const fontEnvelopeBytes = (data: unknown) =>
  Buffer.byteLength(JSON.stringify({ code: 0, message: 'ok', data }), 'utf8');
export const fontEtag = (data: unknown) =>
  `"${createHash('sha256').update(JSON.stringify(data)).digest('hex')}"`;

export function fontCatalogPage(
  releaseId: string,
  revision: number,
  entries: FontCatalogEntryDto[],
  query: FontCatalogQueryDto,
): FontCatalogPageDto {
  let offset = 0;
  if (query.cursor) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (
        !Array.isArray(decoded) ||
        decoded.length !== 4 ||
        decoded[0] !== releaseId ||
        decoded[1] !== revision ||
        decoded[2] !== query.limit ||
        !Number.isSafeInteger(decoded[3]) ||
        decoded[3] < 0 ||
        decoded[3] > entries.length
      )
        throw new Error('stale');
      offset = decoded[3] as number;
    } catch {
      throw new BusinessException(
        ErrorCode.TEXT_FONT_CATALOG_CHANGED,
        '字体目录已更新，请重新读取',
        HttpStatus.CONFLICT,
      );
    }
  }
  const cursorAt = (index: number) =>
    index < entries.length
      ? Buffer.from(JSON.stringify([releaseId, revision, query.limit, index])).toString('base64url')
      : null;
  const result: FontCatalogPageDto = {
    fontVersion: 2,
    releaseId,
    revision,
    items: [],
    nextCursor: cursorAt(offset),
  };
  while (offset < entries.length && result.items.length < query.limit) {
    const candidate = {
      ...result,
      items: [...result.items, entries[offset]],
      nextCursor: cursorAt(offset + 1),
    };
    if (fontEnvelopeBytes(candidate) > FONT_METADATA_MAX_BYTES) break;
    Object.assign(result, candidate);
    offset++;
  }
  return result;
}
