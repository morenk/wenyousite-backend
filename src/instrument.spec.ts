import * as Sentry from '@sentry/node';
import { scrubSentryEvent, SentryEvent } from './instrument';

describe('Sentry event scrubbing', () => {
  it('移除凭据、用户数据、查询参数、正文和异常原文', () => {
    const event = {
      type: undefined,
      event_id: 'event-1',
      environment: 'production',
      release: 'build-sha',
      transaction: 'GET /api/v1/users/transaction-secret',
      fingerprint: ['fingerprint-secret'],
      message: 'password=message-secret',
      request: {
        method: 'GET',
        url: 'https://wenyou.site/api/v1/users/1?token=query-secret',
        query_string: 'token=query-secret',
        data: { password: 'body-secret' },
        headers: {
          authorization: 'Bearer header-secret',
          cookie: 'refresh=refresh-secret',
          'x-request-id': 'request-1',
        },
      },
      user: { id: 'user-1', email: 'private@example.com', ip_address: '127.0.0.1' },
      extra: { token: 'extra-secret' },
      breadcrumbs: [{ message: 'breadcrumb-secret', data: { password: 'secret' } }],
      tags: {
        request_id: 'request-1',
        'http.status_code': '500',
        user_email: 'private@example.com',
      },
      exception: {
        values: [
          {
            type: 'DatabaseError',
            value: 'postgresql://user:password@host/db',
            mechanism: { type: 'generic', data: { password: 'mechanism-secret' } },
            stacktrace: {
              frames: [
                {
                  filename: 'service.ts',
                  function: 'handle',
                  vars: { password: 'frame-secret' },
                },
              ],
            },
          },
        ],
      },
      contexts: {
        trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) },
        user: { email: 'private@example.com' },
      },
    } as unknown as SentryEvent;

    const scrubbed = scrubSentryEvent(event);
    const serialized = JSON.stringify(scrubbed);

    expect(scrubbed.request).toEqual({
      method: 'GET',
      headers: { 'x-request-id': 'request-1' },
    });
    expect(scrubbed.tags).toEqual({
      request_id: 'request-1',
      'http.status_code': '500',
    });
    expect(scrubbed.exception?.values?.[0]?.value).toBe('DatabaseError: unexpected server error');
    for (const secret of [
      'query-secret',
      'body-secret',
      'header-secret',
      'refresh-secret',
      'private@example.com',
      'extra-secret',
      'breadcrumb-secret',
      'postgresql://',
      'transaction-secret',
      'fingerprint-secret',
      'mechanism-secret',
      'frame-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('发送到 transport 前实际应用脱敏钩子', async () => {
    const envelopes: unknown[] = [];
    Sentry.init({
      dsn: 'https://public@example.invalid/1',
      integrations: [],
      beforeSend: scrubSentryEvent,
      transport: () => ({
        send: async (envelope) => {
          envelopes.push(envelope);
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });

    Sentry.withScope((scope) => {
      scope.setUser({ email: 'transport-private@example.com' });
      scope.setExtra('requestBody', { password: 'transport-body-secret' });
      scope.setTag('error_code', '50000');
      Sentry.captureException(new Error('transport-error-secret'));
    });

    await expect(Sentry.flush(1_000)).resolves.toBe(true);
    const serialized = JSON.stringify(envelopes);
    expect(envelopes).toHaveLength(1);
    expect(serialized).toContain('unexpected server error');
    expect(serialized).toContain('50000');
    expect(serialized).not.toContain('transport-private@example.com');
    expect(serialized).not.toContain('transport-body-secret');
    expect(serialized).not.toContain('transport-error-secret');
    await Sentry.close(1_000);
  });
});
