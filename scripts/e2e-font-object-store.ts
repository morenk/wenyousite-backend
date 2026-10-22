/** 本轮独立 S3 协议夹具：仅固定字体前缀，校验 SigV4，拒绝匿名资源访问。 */
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { createServer, IncomingMessage } from 'node:http';
import { readFileSync, lstatSync, writeFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, stat, open, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { processStart } from './e2e-processes';

const root = process.env.E2E_RESOURCE_ROOT!;
const configPath = join(root, 'font-object-store.private.json');
const record = lstatSync(configPath);
assert(!record.isSymbolicLink() && record.uid === process.getuid?.() && (record.mode & 0o077) === 0);
const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
  runId: string; bucket: string; accessKey: string; secret: string; identity: string;
};
const owner = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
assert(config.runId === process.env.E2E_RUN_ID && owner.runId === config.runId && owner.root === realpathSync(root));
assert(process.getuid?.() !== 0 && owner.uid === process.getuid?.());
const directory = join(root, 'font-object-store');
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function authorized(request: IncomingMessage, url: URL, body: Buffer): boolean {
  const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/u.exec(request.headers.authorization ?? '');
  if (!auth || auth[1] !== config.accessKey) return false;
  const payloadHash = String(request.headers['x-amz-content-sha256'] ?? sha(body));
  if (payloadHash !== 'UNSIGNED-PAYLOAD' && payloadHash !== sha(body)) return false;
  const headers = auth[4].split(';').map(name => `${name}:${String(request.headers[name] ?? '').trim().replace(/\s+/gu, ' ')}\n`).join('');
  const query = [...url.searchParams.entries()].map(([key, value]) => [encode(key), encode(value)]).sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)).map(([key, value]) => `${key}=${value}`).join('&');
  const canonical = [request.method, url.pathname, query, headers, auth[4], payloadHash].join('\n');
  const scope = `${auth[2]}/${auth[3]}/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.secret, auth[2]), auth[3]), 's3'), 'aws4_request');
  const expected = hmac(signingKey, ['AWS4-HMAC-SHA256', request.headers['x-amz-date'], scope, sha(canonical)].join('\n'));
  return timingSafeEqual(expected, Buffer.from(auth[5], 'hex'));
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url!, 'http://127.0.0.1');
    const error = (status: number, code: string) => { response.writeHead(status, { 'content-type': 'application/xml' }); response.end(`<Error><Code>${code}</Code></Error>`); };
    if (request.method === 'GET' && url.pathname === '/__e2e_identity') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ runId: config.runId, identity: config.identity, pid: process.pid, start: processStart(process.pid), bucket: config.bucket })); return;
    }
    const prefix = '/' + config.bucket + '/';
    if (!url.pathname.startsWith(prefix) || !/^text-fonts\/v2\/(?:sources|assets)\/[a-f0-9]{64}\.(?:ttf|otf|woff2|json|png)$/u.test(url.pathname.slice(prefix.length))) return error(403, 'AccessDenied');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 67108864) return error(413, 'EntityTooLarge'); chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    if (!authorized(request, url, body)) return error(403, 'AccessDenied');
    const path = join(directory, config.bucket, url.pathname.slice(prefix.length));
    if (request.method === 'PUT') {
      if (request.headers['if-none-match'] !== '*') return error(400, 'InvalidRequest');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = path + '.' + randomBytes(12).toString('hex') + '.tmp';
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, path); }
      catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'EEXIST') return error(412, 'PreconditionFailed'); throw failure; }
      finally { await unlink(temporary); }
      response.setHeader('ETag', '"' + sha(body) + '"'); response.end(); return;
    }
    if (request.method === 'HEAD' || request.method === 'GET') {
      let info;
      try { info = await stat(path); } catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return error(404, 'NoSuchKey'); throw failure; }
      response.setHeader('content-length', info.size);
      response.setHeader('content-type', 'application/octet-stream');
      response.end(request.method === 'HEAD' ? undefined : await readFile(path)); return;
    }
    return error(405, 'MethodNotAllowed');
  })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address(); assert(address && typeof address === 'object');
  writeFileSync(join(root, 'font-object-store.ready.json'), JSON.stringify({
    runId: config.runId, identity: config.identity, pid: process.pid, start: processStart(process.pid),
    endpoint: `http://127.0.0.1:${address.port}`, directory, bucket: config.bucket,
  }), { mode: 0o600, flag: 'wx' });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
