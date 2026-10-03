import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { StreamingApkOrigin } from '../../src/app-downloads/download-origin';
import { fileName, Artifact } from '../../src/app-downloads/download-model';
import { APK_MEDIA_TYPE } from '../../src/app-downloads/app-download.contract';
import { verifyS3Signature } from '../dev-preview/signature';

const S3rver = require('s3rver') as new (options: Record<string, unknown>) => { configureBuckets(): Promise<void>; callback(): (req: IncomingMessage, res: ServerResponse) => void };
export async function privateObjectStore(root: string) {
  const directory = join(root, 'object-store'); await mkdir(directory, { mode: 0o700 });
  const store = new S3rver({ directory, silent: true, resetOnClose: false, allowMismatchedSignatures: false, vhostBuckets: false, configureBuckets: [{ name: 'wenyou-apk' }] }); await store.configureBuckets();
  const handler = store.callback(), counts = { head: 0, get: 0, denied: 0, writes: 0 };
  let endpoint = '';
  const server = createServer((req, res) => {
    void (async () => {
      assert(req.headers.authorization); await verifyS3Signature(req, endpoint);
      if (req.method === 'HEAD') counts.head++; if (req.method === 'GET') counts.get++;
      if (!['HEAD','GET'].includes(req.method || '')) counts.writes++;
      handler(req, res);
    })().catch(() => { counts.denied++; res.writeHead(403); res.end(); });
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = (server.address() as { port: number }).port; endpoint = `http://127.0.0.1:${port}`;
  const makeClient = () => new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' }, maxAttempts: 1 });
  const client = makeClient(), origin = new StreamingApkOrigin(makeClient());
  return { endpoint, counts, origin, async upload(a: Artifact, body: Buffer) { await client.send(new PutObjectCommand({ Bucket: a.bucket, Key: a.key, Body: body, ContentType: APK_MEDIA_TYPE, ContentDisposition: `attachment; filename="${fileName(a)}"`, Metadata: { 'apk-sha256': a.sha256, 'application-id': a.applicationId, 'version-name': a.versionName, 'version-code': String(a.buildNumber) } })); }, async close() { client.destroy(); origin.close(); server.closeAllConnections(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); } };
}
