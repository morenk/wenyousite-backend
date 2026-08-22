import { config as loadDotEnv } from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import configuration from './config/configuration';

loadDotEnv({ path: ['.env.local', '.env'], override: false, quiet: true });

type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
export type SentryEvent = Parameters<NonNullable<SentryOptions['beforeSend']>>[0];

const ALLOWED_TAGS = new Set([
  'request_id',
  'http.method',
  'http.route',
  'http.status_code',
  'error_code',
  'environment',
  'release',
]);

/** Sentry 只保留定位服务端故障所需的机器信息，不上传凭据或用户输入。 */
export function scrubSentryEvent(event: SentryEvent): SentryEvent {
  const requestId = Object.entries(event.request?.headers ?? {}).find(
    ([key]) => key.toLowerCase() === 'x-request-id',
  )?.[1];
  const tags = Object.fromEntries(
    Object.entries(event.tags ?? {}).filter(([key]) => ALLOWED_TAGS.has(key)),
  );
  if (requestId) tags.request_id = String(requestId);
  const trace = event.contexts?.trace;

  return {
    type: event.type,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    environment: event.environment,
    exception: event.exception
      ? {
          values: event.exception.values?.map((value) => ({
            type: value.type,
            value: value.type
              ? `${value.type}: unexpected server error`
              : 'Unexpected server error',
            stacktrace: value.stacktrace
              ? {
                  frames: value.stacktrace.frames?.map((frame) => ({
                    filename: frame.filename,
                    function: frame.function,
                    module: frame.module,
                    lineno: frame.lineno,
                    colno: frame.colno,
                    in_app: frame.in_app,
                  })),
                }
              : undefined,
          })),
        }
      : undefined,
    request: event.request
      ? {
          method: event.request.method,
          headers: requestId ? { 'x-request-id': String(requestId) } : undefined,
        }
      : undefined,
    tags,
    contexts: trace
      ? {
          trace: {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            parent_span_id: trace.parent_span_id,
            op: trace.op,
            status: trace.status,
            origin: trace.origin,
          },
        }
      : undefined,
    sdk: event.sdk,
  };
}

const runtime = configuration();
Sentry.init({
  dsn: runtime.sentry.dsn || undefined,
  enabled: Boolean(runtime.sentry.dsn),
  environment: runtime.app.nodeEnv,
  release: runtime.app.buildSha,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
});
