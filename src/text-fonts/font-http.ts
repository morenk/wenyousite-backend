import { FastifyReply } from 'fastify';
import { fontEnvelopeBytes, fontEtag, FONT_METADATA_MAX_BYTES } from './font-catalog-page';

export function fontMetadataResponse<T>(
  data: T,
  etag: string | undefined,
  reply: FastifyReply,
): T | void {
  if (fontEnvelopeBytes(data) > FONT_METADATA_MAX_BYTES) throw new Error('font_metadata_size');
  const tag = fontEtag(data);
  reply.header('ETag', tag).header('Cache-Control', 'no-cache');
  if (etag === tag) {
    reply.code(304).send();
    return;
  }
  return data;
}
export function fontAssetResponse(
  data: { bytes: Buffer; contentType: string; sha256: string },
  reply: FastifyReply,
  preview = false,
): void {
  reply
    .header('Content-Type', data.contentType)
    .header('Cache-Control', preview ? 'private, no-store' : 'no-cache')
    .header('ETag', `"${data.sha256}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(data.bytes);
}
