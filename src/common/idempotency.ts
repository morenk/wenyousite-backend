import { createHash } from 'node:crypto';

/** 对已经按固定字段顺序构造的请求快照生成稳定摘要。 */
export function hashIdempotencyPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
