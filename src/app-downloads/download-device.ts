import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assertDownload } from './download-model';

export const DEVICE_COOKIE_SECONDS = 30 * 86400;
const signingKey = z
  .object({ id: z.string().regex(/^[a-f0-9]{16}$/), key: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const deviceKeysSchema = z
  .object({
    hashKey: z.string().regex(/^[a-f0-9]{64}$/),
    active: signingKey,
    previous: signingKey.extend({ until: z.number().int().nonnegative() }).nullable(),
  })
  .strict();
export type DeviceKeys = z.infer<typeof deviceKeysSchema>;
export function freshSigningKey() {
  return { id: randomBytes(8).toString('hex'), key: randomBytes(32).toString('hex') };
}
export function freshDeviceKeys(): DeviceKeys {
  return { hashKey: randomBytes(32).toString('hex'), active: freshSigningKey(), previous: null };
}
/** 签名只证明随机浏览器标识由本服务签发，不证明硬件唯一，也不替代 IP 配额。 */
export class DownloadDevice {
  readonly cookieName = '__Host-wenyou-download-device';
  constructor(private readonly keys: DeviceKeys) {
    deviceKeysSchema.parse(keys);
  }
  private signature(value: string, key: string) {
    return createHmac('sha256', Buffer.from(key, 'hex'))
      .update(`${this.cookieName}:${value}`)
      .digest('base64url');
  }
  resolve(cookie: string | undefined, now = Date.now()) {
    assertDownload(Number.isSafeInteger(now) && now >= 0);
    const seconds = Math.floor(now / 1000);
    const values = (cookie || '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(this.cookieName + '='));
    const value = values.length === 1 ? values[0].slice(this.cookieName.length + 1) : '';
    const match =
      /^v1\.([a-f0-9]{16})\.([A-Za-z0-9_-]{43})\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
    let device: string | undefined,
      refresh = true;
    if (match) {
      const [, id, candidate, expires, signature] = match;
      const key =
        id === this.keys.active.id
          ? this.keys.active
          : this.keys.previous?.id === id && this.keys.previous.until > seconds
            ? this.keys.previous
            : undefined;
      if (key && Number(expires) > seconds && Number(expires) <= seconds + DEVICE_COOKIE_SECONDS) {
        const expected = this.signature(value.slice(0, value.lastIndexOf('.')), key.key);
        if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          device = candidate;
          refresh =
            id !== this.keys.active.id || Number(expires) - seconds < DEVICE_COOKIE_SECONDS / 2;
        }
      }
    }
    const recognized = !!device;
    device ??= randomBytes(32).toString('base64url');
    let setCookie: string | undefined;
    if (refresh) {
      const token = `v1.${this.keys.active.id}.${device}.${seconds + DEVICE_COOKIE_SECONDS}`;
      setCookie = `${this.cookieName}=${token}.${this.signature(token, this.keys.active.key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_COOKIE_SECONDS}; Secure`;
    }
    return { device, recognized, setCookie };
  }
}
