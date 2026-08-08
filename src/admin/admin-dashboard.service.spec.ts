import { ReportReasonCode, ReportStatus, UserRole, UserSanctionType } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminDashboardService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    user: { count: jest.fn(), groupBy: jest.fn() },
    thread: { count: jest.fn(), groupBy: jest.fn() },
    post: { count: jest.fn() },
    report: { count: jest.fn(), groupBy: jest.fn() },
    threadCategoryDefinition: { findMany: jest.fn() },
    userSanction: { groupBy: jest.fn() },
  };
  let service: AdminDashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminDashboardService(prisma as unknown as PrismaService);
  });

  it('returns current, previous, activity and snapshot metrics with fixed timezone', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 10n }])
      .mockResolvedValueOnce([{ count: 7n }])
      .mockResolvedValueOnce([{ dau: 4n, wau: 12n, mau: 30n }]);
    prisma.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(100);
    prisma.thread.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    prisma.post.count.mockResolvedValueOnce(20).mockResolvedValueOnce(15);
    prisma.report.count
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(8);
    prisma.userSanction.groupBy.mockResolvedValue([
      { type: UserSanctionType.SUSPENSION, _count: { _all: 2 } },
      { type: UserSanctionType.BAN, _count: { _all: 1 } },
    ]);

    const result = await service.overview(
      { from: '2026-08-01', to: '2026-08-08' },
      new Date('2026-08-08T08:00:00.000Z'),
    );

    expect(result).toEqual({
      range: {
        from: '2026-08-01',
        to: '2026-08-08',
        previousFrom: '2026-07-24',
        previousTo: '2026-07-31',
        timezone: 'Asia/Shanghai',
      },
      activity: { dau: 4, wau: 12, mau: 30 },
      current: {
        activeUsers: 10,
        newUsers: 5,
        publishedThreads: 4,
        newPosts: 20,
        reportsReceived: 6,
        reportsHandled: 5,
      },
      previous: {
        activeUsers: 7,
        newUsers: 3,
        publishedThreads: 2,
        newPosts: 15,
        reportsReceived: 3,
        reportsHandled: 2,
      },
      snapshot: {
        totalUsers: 100,
        pendingReports: 8,
        activeSuspensions: 2,
        activeBans: 1,
      },
    });
  });

  it('fills typed timeseries points returned by PostgreSQL', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        day: new Date('2026-08-08T00:00:00.000Z'),
        dau: 3,
        newUsers: 1,
        publishedThreads: 2,
        newPosts: 4,
        reportsReceived: 1,
        reportsHandled: 0,
      },
    ]);

    const result = await service.timeseries(
      { from: '2026-08-08', to: '2026-08-08' },
      new Date('2026-08-08T08:00:00.000Z'),
    );

    expect(result.items).toEqual([
      {
        date: '2026-08-08',
        dau: 3,
        newUsers: 1,
        publishedThreads: 2,
        newPosts: 4,
        reportsReceived: 1,
        reportsHandled: 0,
      },
    ]);
  });

  it('returns every enum bucket including zero-count distributions', async () => {
    prisma.user.groupBy.mockResolvedValue([{ role: UserRole.USER, _count: { _all: 12 } }]);
    prisma.report.groupBy
      .mockResolvedValueOnce([{ status: ReportStatus.PENDING, _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ reasonCode: ReportReasonCode.SPAM, _count: { _all: 1 } }]);
    prisma.thread.groupBy.mockResolvedValue([{ category: 'RPG', _count: { _all: 3 } }]);
    prisma.threadCategoryDefinition.findMany.mockResolvedValue([
      { slug: 'DEDUCTION' },
      { slug: 'RPG' },
    ]);
    prisma.userSanction.groupBy.mockResolvedValue([]);

    const result = await service.distributions(new Date('2026-08-08T08:00:00.000Z'));

    expect(result.usersByRole).toContainEqual({ key: UserRole.USER, count: 12 });
    expect(result.usersByRole).toContainEqual({ key: UserRole.ADMIN, count: 0 });
    expect(result.reportsByStatus).toContainEqual({ key: ReportStatus.PENDING, count: 2 });
    expect(result.reportsByReason).toContainEqual({ key: ReportReasonCode.SPAM, count: 1 });
    expect(result.threadsByCategory).toEqual([
      { key: 'DEDUCTION', count: 0 },
      { key: 'RPG', count: 3 },
    ]);
    expect(result.activeSanctionsByType).toEqual([
      { key: UserSanctionType.SUSPENSION, count: 0 },
      { key: UserSanctionType.BAN, count: 0 },
    ]);
  });

  it.each([
    [{ from: '2026-08-09', to: '2026-08-08' }, 'from 不能晚于 to'],
    [{ from: '2025-01-01', to: '2026-08-08' }, '统计区间不能超过 366 天'],
    [{ from: '2026-02-29', to: '2026-03-01' }, '日期必须是有效的 YYYY-MM-DD'],
  ])('rejects invalid dashboard ranges', async (query, message) => {
    await expect(service.overview(query)).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
      message,
    });
  });
});
