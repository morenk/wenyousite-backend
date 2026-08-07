import { randomUUID } from 'crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** 接受客户端生成的安全请求号；缺失或格式异常时生成全局唯一 UUID。 */
export function requestIdFromHeader(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}
