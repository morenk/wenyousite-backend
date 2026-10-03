import { performance } from 'node:perf_hooks';
import { isIP } from 'node:net';
import { DOWNLOAD_LIMITS } from './app-download.contract';
import { assertDownload, DownloadFailure } from './download-model';

export function trustedIp(value: unknown) {
  assertDownload(typeof value === 'string' && isIP(value) !== 0);
  // IPv4-mapped IPv6 和同地址的不同 IPv6 拼写不能获得额外配额。
  const canonical = isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16),
    low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
export class Admission {
  private readonly requests = new Map<string, number[]>();
  private readonly active = new Map<string, number>();
  private total = 0;
  request(ip: string, now = performance.now()) {
    for (const [key, values] of this.requests)
      if (values.at(-1)! <= now - 60_000) this.requests.delete(key);
    const values = (this.requests.get(ip) ?? []).filter((t) => t > now - 60_000);
    if (values.length >= DOWNLOAD_LIMITS.requestsPerMinute)
      throw new DownloadFailure(
        429,
        Math.max(1, Math.ceil((values[0] + 60_000 - now) / 1000)),
        'request_rate',
      );
    if (!this.requests.has(ip) && this.requests.size >= 4096) throw new DownloadFailure(503);
    values.push(now);
    this.requests.set(ip, values);
  }
  acquire(ip: string) {
    const count = this.active.get(ip) ?? 0;
    if (this.total >= DOWNLOAD_LIMITS.globalConnections || count >= DOWNLOAD_LIMITS.ipConnections)
      throw new DownloadFailure(429, 1, 'concurrency');
    this.total++;
    this.active.set(ip, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const n = this.active.get(ip)! - 1;
      if (n) this.active.set(ip, n);
      else this.active.delete(ip);
    };
  }
  count() {
    return this.total;
  }
}

type Waiter = {
  bytes: number;
  resolve: () => void;
  reject: (error: Error) => void;
  remove: () => void;
};
type Flow = { tokens: number; waiter?: Waiter };
/** 每连接最多一个待发送块；固定小桶和轮转调度，慢连接不会占住其他连接的轮次。 */
export class Bandwidth {
  private readonly flows = new Map<symbol, Flow>();
  private tokens = 0;
  private last = performance.now();
  private cursor = 0;
  private readonly timer = setInterval(() => this.tick(), 10);
  constructor() {
    this.timer.unref();
  }
  add() {
    assertDownload(this.flows.size < DOWNLOAD_LIMITS.globalConnections);
    const id = Symbol();
    this.flows.set(id, { tokens: 0 });
    return id;
  }
  remove(id: symbol) {
    const flow = this.flows.get(id);
    flow?.waiter?.remove();
    flow?.waiter?.reject(new DownloadFailure(503));
    this.flows.delete(id);
  }
  take(id: symbol, bytes: number, signal: AbortSignal) {
    const flow = this.flows.get(id);
    assertDownload(flow && !flow.waiter && bytes > 0 && bytes <= 8192);
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        flow.waiter = undefined;
        reject(new DownloadFailure(503));
      };
      signal.addEventListener('abort', abort, { once: true });
      flow.waiter = {
        bytes,
        resolve,
        reject,
        remove: () => signal.removeEventListener('abort', abort),
      };
    });
  }
  smallResponse(bytes: number) {
    assertDownload(bytes > 0 && bytes <= 8192);
    this.tick();
    if (bytes > this.tokens) return false;
    this.tokens -= bytes;
    return true;
  }
  private tick() {
    const now = performance.now(),
      elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(8192, this.tokens + elapsed * DOWNLOAD_LIMITS.globalBytesPerSecond);
    const flows = [...this.flows.values()];
    for (const flow of flows)
      flow.tokens = Math.min(
        8192,
        flow.tokens + elapsed * DOWNLOAD_LIMITS.connectionBytesPerSecond,
      );
    for (let i = 0; i < flows.length; i++) {
      const index = (this.cursor + i) % flows.length,
        flow = flows[index],
        wait = flow.waiter;
      if (!wait || wait.bytes > flow.tokens || wait.bytes > this.tokens) continue;
      this.tokens -= wait.bytes;
      flow.tokens -= wait.bytes;
      flow.waiter = undefined;
      wait.remove();
      wait.resolve();
      this.cursor = (index + 1) % flows.length;
      break;
    }
  }
  close() {
    clearInterval(this.timer);
    for (const id of this.flows.keys()) this.remove(id);
  }
}
