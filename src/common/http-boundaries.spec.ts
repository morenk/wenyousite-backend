import {
  ArgumentsHost,
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginatedResult } from './dto/paginated-result';
import { BusinessException } from './exceptions/business.exception';
import { ErrorCode } from './exceptions/error-codes';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { AdminGuard } from './guards/admin.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { SKIP_VERIFIED_KEY, VerifiedGuard } from './guards/verified.guard';
import { TransformInterceptor } from './interceptors/response.interceptor';
import { ParseUUIDPipe } from './pipes/uuid-validation.pipe';
import { API_CONTRACT_VERSION } from './swagger/openapi-document';

function httpContext(user?: unknown, requestOverrides: Record<string, unknown> = {}) {
  const request = {
    id: 'request-1',
    method: 'GET',
    url: '/api/test',
    query: {},
    headers: {},
    user,
    ...requestOverrides,
  };
  const response = {
    header: jest.fn(),
    hasHeader: jest.fn().mockReturnValue(false),
    status: jest.fn(),
    send: jest.fn(),
  };
  response.header.mockReturnValue(response);
  response.status.mockReturnValue(response);
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  };
  return {
    request,
    response,
    context: context as unknown as ExecutionContext,
    host: context as unknown as ArgumentsHost,
  };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(
      (filter as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      'error',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('保留业务异常的机器错误码并写响应契约头', () => {
    const { host, response } = httpContext();

    filter.catch(
      new BusinessException(ErrorCode.EMAIL_NOT_VERIFIED, '请先验证邮箱', HttpStatus.FORBIDDEN),
      host,
    );

    expect(response.header).toHaveBeenCalledWith('X-Request-ID', 'request-1');
    expect(response.header).toHaveBeenCalledWith('X-API-Contract-Version', API_CONTRACT_VERSION);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(response.send).toHaveBeenCalledWith({
      code: ErrorCode.EMAIL_NOT_VERIFIED,
      message: '请先验证邮箱',
      data: null,
    });
  });

  it('合并 ValidationPipe 的多条校验消息', () => {
    const { host, response } = httpContext();

    filter.catch(new BadRequestException({ message: ['标题不能为空', '标题过长'] }), host);

    expect(response.send).toHaveBeenCalledWith({
      code: ErrorCode.VALIDATION_ERROR,
      message: '标题不能为空; 标题过长',
      data: null,
    });
  });

  it('游标查询遇到 Prisma P2025 时转换为无效游标而非服务端错误', () => {
    const { host, response } = httpContext(undefined, { query: { cursor: 'missing' } });
    const error = new Prisma.PrismaClientKnownRequestError('record not found', {
      code: 'P2025',
      clientVersion: '6.14.0',
    });

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.send).toHaveBeenCalledWith({
      code: ErrorCode.INVALID_CURSOR,
      message: '分页游标无效或不属于当前列表',
      data: null,
    });
  });

  it('限流响应仅在上游未设置时补充 Retry-After', () => {
    const { host, response } = httpContext();

    filter.catch(new HttpException('请求过快', HttpStatus.TOO_MANY_REQUESTS), host);

    expect(response.header).toHaveBeenCalledWith('Retry-After', '60');
    expect(response.send).toHaveBeenCalledWith({
      code: ErrorCode.RATE_LIMITED,
      message: '请求过快',
      data: null,
    });
  });

  it('未知异常不泄露内部错误信息', () => {
    const { host, response } = httpContext();

    filter.catch(new Error('database password leaked'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.send).toHaveBeenCalledWith({
      code: ErrorCode.INTERNAL_ERROR,
      message: '服务器内部错误',
      data: null,
    });
  });
});

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  it('普通成功响应加契约头并递归清理注销用户摘要', async () => {
    const { context, response } = httpContext();
    const next = {
      handle: () => of({
        author: {
          id: 'deleted-user',
          username: '原用户名',
          avatar: 'https://cdn.example.com/avatar.webp',
          deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
    } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(context, next))).resolves.toEqual({
      code: 0,
      message: 'ok',
      data: {
        author: {
          id: 'deleted-user',
          username: '已注销用户',
          avatar: null,
        },
      },
    });
    expect(response.header).toHaveBeenCalledWith('X-Request-ID', 'request-1');
    expect(response.header).toHaveBeenCalledWith('X-API-Contract-Version', API_CONTRACT_VERSION);
  });

  it('分页结果把 items 和 pagination 分别映射到 data 与 meta', async () => {
    const { context } = httpContext();
    const next = {
      handle: () => of(new PaginatedResult([{ id: 'item-1' }], {
        cursor: 'item-1',
        hasMore: true,
      })),
    } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(context, next))).resolves.toEqual({
      code: 0,
      message: 'ok',
      data: [{ id: 'item-1' }],
      meta: { cursor: 'item-1', hasMore: true },
    });
  });
});

describe('认证和权限边界', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'])('AdminGuard 允许 %s', (role) => {
    const { context } = httpContext({ role });
    expect(new AdminGuard().canActivate(context)).toBe(true);
  });

  it('AdminGuard 拒绝缺失用户和普通用户', () => {
    expect(() => new AdminGuard().canActivate(httpContext().context)).toThrow(ForbiddenException);
    expect(() => new AdminGuard().canActivate(httpContext({ role: 'USER' }).context)).toThrow(
      '需要管理员权限',
    );
  });

  it('VerifiedGuard 尊重跳过元数据且拒绝未验证用户', () => {
    const reflector = { getAllAndOverride: jest.fn() };
    const guard = new VerifiedGuard(reflector as unknown as Reflector);
    const unverified = httpContext({ emailVerified: false }).context;

    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(unverified)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      SKIP_VERIFIED_KEY,
      expect.any(Array),
    );

    reflector.getAllAndOverride.mockReturnValue(false);
    expect(() => guard.canActivate(unverified)).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.EMAIL_NOT_VERIFIED }),
    );
    expect(guard.canActivate(httpContext().context)).toBe(true);
  });

  it('JwtAuthGuard 公开路由直接放行', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(httpContext().context)).toBe(true);
  });

  it('JwtAuthGuard 区分缺少、过期和无效令牌', () => {
    const reflector = { getAllAndOverride: jest.fn() };
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);

    expect(() => guard.handleRequest(null, null, null, httpContext().context)).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.UNAUTHORIZED }),
    );
    expect(() => guard.handleRequest(
      null,
      null,
      { name: 'TokenExpiredError' },
      httpContext(undefined, { headers: { authorization: 'Bearer expired' } }).context,
    )).toThrow(expect.objectContaining({ errorCode: ErrorCode.TOKEN_EXPIRED }));
    expect(() => guard.handleRequest(
      null,
      null,
      { name: 'JsonWebTokenError' },
      httpContext(undefined, { headers: { authorization: 'Bearer invalid' } }).context,
    )).toThrow(expect.objectContaining({ errorCode: ErrorCode.TOKEN_INVALID }));
  });

  it('OptionalJwtAuthGuard 将认证失败或无用户统一降级为匿名', () => {
    const guard = new OptionalJwtAuthGuard();
    expect(guard.handleRequest(new Error('invalid'), undefined)).toBeNull();
    expect(guard.handleRequest(null, { id: 'user-1' })).toEqual({ id: 'user-1' });
  });
});

describe('ParseUUIDPipe', () => {
  const pipe = new ParseUUIDPipe();

  it('接受 UUID v4 并拒绝其他路径参数', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(pipe.transform(uuid)).toBe(uuid);
    expect(() => pipe.transform('not-a-uuid')).toThrow(BadRequestException);
  });
});
