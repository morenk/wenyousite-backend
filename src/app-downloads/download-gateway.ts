import type { FileHandle } from 'node:fs/promises';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';
import { APK_MEDIA_TYPE, DOWNLOAD_PREFIX } from './app-download.contract';
import { AndroidDownloadInfoDto } from './app-download.dto';
import { DownloadHandler } from './app-downloads.controller';
import { DownloadBudget } from './download-budget';
import { DownloadCache } from './download-cache';
import { Admission, Bandwidth, trustedIp } from './download-limits';
import { Artifact, DownloadFailure, assertDownload, fileName, publicInfo } from './download-model';
import { selectRange } from './download-range';

export class DownloadGateway implements DownloadHandler {
  readonly admission = new Admission();
  private readonly bandwidth = new Bandwidth();
  private readonly active = new Set<AbortController>();
  readonly metrics = {
    requests: 0,
    rejected: 0,
    completed: 0,
    interrupted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rejectionReasons: {
      request_rate: 0,
      concurrency: 0,
      budget: 0,
      unavailable: 0,
      range: 0,
      not_found: 0,
    },
  };
  constructor(
    private readonly budget: DownloadBudget,
    private readonly cache: DownloadCache,
  ) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    if (request.url === '/__metrics' && request.method === 'GET') {
      try {
        return void reply.header('Cache-Control', 'no-store').send({
          ...this.metrics,
          active: this.admission.count(),
          outbound: this.budget.status(),
        });
      } catch {
        return void reply
          .status(503)
          .header('Cache-Control', 'no-store')
          .send({ status: 'unavailable' });
      }
    }
    if (request.url === '/__health' && request.method === 'GET') {
      // 不读取目录/账本、不预留流量，不暴露余额；只说明独立进程正在响应。
      return void reply.header('Cache-Control', 'no-store').send({ status: 'ok' });
    }
    reply
      .header('X-Request-ID', randomUUID())
      .header('X-API-Contract-Version', API_CONTRACT_VERSION)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    this.metrics.requests++;
    let release: (() => void) | undefined, file: FileHandle | undefined, flow: symbol | undefined;
    const controller = new AbortController(),
      signal = controller.signal;
    const closed = () => controller.abort();
    reply.raw.once('close', closed);
    const deadline = setTimeout(closed, 3600_000);
    deadline.unref();
    this.active.add(controller);
    try {
      assertDownload(!request.raw.socket.remoteAddress); // Unix socket only; 不信任任意 TCP peer。
      const ip = trustedIp(request.headers['x-real-ip']);
      this.admission.request(ip);
      release = this.admission.acquire(ip);
      assertDownload(
        ['GET', 'HEAD'].includes(request.method) &&
          !request.headers['transfer-encoding'] &&
          (!request.headers['content-length'] || request.headers['content-length'] === '0'),
      );
      const catalog = await this.cache.catalog();
      signal.throwIfAborted();
      if (request.url === `${DOWNLOAD_PREFIX}/android` && request.method === 'GET') {
        const info: AndroidDownloadInfoDto = {
          status: catalog.state,
          release: null,
          retryAfterSeconds: null,
        };
        if (catalog.state === 'available') {
          const entry = catalog.artifacts.find(
            (a) => a.artifact.buildNumber === catalog.recommendedBuild && a.publishedAt,
          );
          assertDownload(entry?.publishedAt);
          const retry = this.budget.available(entry.artifact.sizeBytes + 4096);
          if (retry) {
            info.status = 'paused';
            info.retryAfterSeconds = retry;
          } else {
            try {
              file = await this.openCache(entry.artifact);
              info.release = publicInfo(entry.artifact, entry.publishedAt);
            } catch {
              info.status = 'unavailable';
              info.retryAfterSeconds = 60;
            }
          }
        }
        return this.json(request, reply, 200, { code: 0, message: 'ok', data: info });
      }
      const match = new RegExp(`^${DOWNLOAD_PREFIX}/android/([1-9][0-9]{0,9})/file$`).exec(
        request.url,
      );
      if (!match || Number(match[1]) > 2100000000) throw new DownloadFailure(404);
      if (catalog.state !== 'available') throw new DownloadFailure(503, 60);
      const entry = catalog.artifacts.find(
        (a) => a.artifact.buildNumber === Number(match[1]) && a.publishedAt,
      );
      if (!entry?.publishedAt) throw new DownloadFailure(404);
      file = await this.openCache(entry.artifact);
      const a = entry.artifact,
        etag = `"${a.sha256}"`,
        modified = new Date(entry.publishedAt).toUTCString();
      let range: ReturnType<typeof selectRange>;
      try {
        range = selectRange(
          request.headers.range,
          a.sizeBytes,
          typeof request.headers['if-range'] === 'string' ? request.headers['if-range'] : undefined,
          etag,
          modified,
        );
      } catch (error) {
        reply.header('Content-Range', `bytes */${a.sizeBytes}`);
        throw error;
      }
      signal.throwIfAborted();
      await this.assertPublished(a);
      this.fileHeaders(reply, a, modified, etag, range.length);
      if (range.partial)
        reply.header('Content-Range', `bytes ${range.start}-${range.end}/${a.sizeBytes}`);
      if (request.method === 'HEAD') {
        reply.status(range.partial ? 206 : 200).send();
        return;
      }
      this.budget.reserve(range.length);
      // 从校验到发头再次检查状态，撤回不会因耗时哈希而被绕过。
      await this.assertPublished(a);
      flow = this.bandwidth.add();
      const response = reply.raw;
      reply.status(range.partial ? 206 : 200);
      reply.hijack();
      response.writeHead(
        reply.statusCode,
        Object.fromEntries(
          Object.entries(reply.getHeaders())
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) ? value : String(value)]),
        ),
      );
      response.setTimeout(15_000, closed);
      let position = range.start;
      while (position <= range.end) {
        signal.throwIfAborted();
        await this.assertPublished(a);
        const bytes = Math.min(8192, range.end - position + 1);
        const buffer = Buffer.alloc(bytes),
          result = await file.read(buffer, 0, bytes, position);
        assertDownload(result.bytesRead === bytes);
        await this.bandwidth.take(flow, bytes, signal);
        const drained = response.write(buffer);
        if (!drained) await once(response, 'drain', { signal });
        position += bytes;
      }
      response.end();
      this.metrics.completed++;
    } catch (error) {
      if (reply.raw.headersSent || reply.raw.destroyed || signal.aborted) {
        reply.raw.destroy();
        this.metrics.interrupted++;
      } else {
        this.metrics.rejected++;
        const failure = error instanceof DownloadFailure ? error : new DownloadFailure(503, 60);
        this.metrics.rejectionReasons[
          failure.status === 416 ? 'range' : failure.status === 404 ? 'not_found' : failure.reason
        ]++;
        if (failure.retryAfter) reply.header('Retry-After', failure.retryAfter);
        for (const key of [
          'Content-Length',
          'Content-Disposition',
          'Content-Type',
          'ETag',
          'Last-Modified',
          'x-amz-meta-apk-sha256',
          'x-amz-meta-application-id',
          'x-amz-meta-version-name',
          'x-amz-meta-version-code',
        ])
          reply.removeHeader(key);
        this.json(request, reply, failure.status, {
          code:
            failure.status === 429
              ? 42900
              : failure.status === 404
                ? 40400
                : failure.status === 416
                  ? 40001
                  : 50000,
          message: failure.status === 429 ? '下载请求暂受限制' : '下载暂不可用',
          data: null,
        });
      }
    } finally {
      clearTimeout(deadline);
      reply.raw.off('close', closed);
      controller.abort();
      this.active.delete(controller);
      if (flow) this.bandwidth.remove(flow);
      try {
        await file?.close();
      } finally {
        release?.();
      }
    }
  }
  private async openCache(artifact: Artifact) {
    try {
      const file = await this.cache.open(artifact);
      this.metrics.cacheHits++;
      return file;
    } catch (error) {
      this.metrics.cacheMisses++;
      throw error;
    }
  }
  private async assertPublished(artifact: Artifact) {
    const catalog = await this.cache.catalog();
    assertDownload(
      catalog.state === 'available' &&
        catalog.artifacts.some((a) => a.artifact.sha256 === artifact.sha256 && a.publishedAt),
    );
  }
  private json(request: FastifyRequest, reply: FastifyReply, status: number, value: unknown) {
    const body = JSON.stringify(value);
    reply
      .status(status)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Cache-Control', 'no-store');
    if (request.method === 'HEAD') {
      reply.header('Content-Length', Buffer.byteLength(body)).send();
      return;
    }
    // 小型 JSON 也共享全局带宽，限流失败不再生成另一份未计量的正文。
    if (!this.bandwidth.smallResponse(Buffer.byteLength(body))) {
      reply.status(429).header('Retry-After', 1).header('Content-Length', 0).send();
      return;
    }
    try {
      this.budget.reserve(Buffer.byteLength(body));
    } catch (error) {
      const failure = error instanceof DownloadFailure ? error : new DownloadFailure(503, 60);
      reply.status(failure.status);
      if (failure.retryAfter) reply.header('Retry-After', failure.retryAfter);
      reply.header('Content-Length', 0).send();
      return;
    }
    reply.header('Content-Length', Buffer.byteLength(body)).send(body);
  }
  private fileHeaders(
    reply: FastifyReply,
    a: Artifact,
    modified: string,
    etag: string,
    length: number,
  ) {
    reply.headers({
      'Content-Type': APK_MEDIA_TYPE,
      'Content-Length': length,
      'Content-Disposition': `attachment; filename="${fileName(a)}"`,
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': modified,
      'x-amz-meta-apk-sha256': a.sha256,
      'x-amz-meta-application-id': a.applicationId,
      'x-amz-meta-version-name': a.versionName,
      'x-amz-meta-version-code': String(a.buildNumber),
    });
  }
  close() {
    for (const controller of this.active) controller.abort();
    this.bandwidth.close();
  }
}
