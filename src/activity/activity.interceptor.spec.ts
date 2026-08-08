import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityService } from './activity.service';

describe('ActivityInterceptor', () => {
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const next: CallHandler = { handle: () => of({ ok: true }) };

  function context(request: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => jest.clearAllMocks());

  it('records a successful normal-user product request', async () => {
    const interceptor = new ActivityInterceptor(activity as unknown as ActivityService);
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'GET', url: '/api/v1/threads', user: { id: 'u1', role: 'USER' } }),
        next,
      ),
    );
    expect(activity.record).toHaveBeenCalledWith('u1');
  });

  it.each([
    ['anonymous', { method: 'GET', url: '/api/v1/threads' }],
    ['administrator', { method: 'GET', url: '/api/v1/threads', user: { id: 'a1', role: 'ADMIN' } }],
    ['admin route', { method: 'GET', url: '/api/v1/admin', user: { id: 'u1', role: 'USER' } }],
    [
      'notification polling',
      { method: 'GET', url: '/api/v1/notifications/unread', user: { id: 'u1', role: 'USER' } },
    ],
  ])('does not record %s traffic', async (_label, request) => {
    const interceptor = new ActivityInterceptor(activity as unknown as ActivityService);
    await lastValueFrom(interceptor.intercept(context(request), next));
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('does not record failed requests', async () => {
    const interceptor = new ActivityInterceptor(activity as unknown as ActivityService);
    const failed: CallHandler = { handle: () => throwError(() => new Error('failed')) };
    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ method: 'POST', url: '/api/v1/threads', user: { id: 'u1', role: 'USER' } }),
          failed,
        ),
      ),
    ).rejects.toThrow('failed');
    expect(activity.record).not.toHaveBeenCalled();
  });
});
