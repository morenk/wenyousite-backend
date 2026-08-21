import { Injectable } from '@nestjs/common';
import {
  PostKind,
  Prisma,
  ReportReasonCode,
  ReportStatus,
  UserRole,
  UserSanctionType,
} from '@prisma/client';
import {
  ANALYTICS_TIME_ZONE,
  addDateKeyDays,
  analyticsDateKey,
  analyticsDayStart,
  dateKeyDistance,
  isValidDateKey,
} from '../activity/activity-date';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { activeSanctionWhere } from '../access/account-status';
import { AdminDashboardRangeQueryDto } from './dto/dashboard.dto';

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

interface DashboardRange {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  timezone: typeof ANALYTICS_TIME_ZONE;
  fromDate: Date;
  toExclusive: Date;
  previousFromDate: Date;
  previousToExclusive: Date;
}

interface CountRow {
  count: bigint | number;
}

interface TimeseriesRow {
  day: Date | string;
  dau: bigint | number;
  newUsers: bigint | number;
  publishedThreads: bigint | number;
  newPosts: bigint | number;
  reportsReceived: bigint | number;
  reportsHandled: bigint | number;
}

function numeric(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

/** 管理数据面板查询：所有日期按北京时间闭区间解释。 */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: AdminDashboardRangeQueryDto, now = new Date()) {
    const range = this.resolveRange(query, now);
    const [current, previous, activity, totalUsers, pendingReports, sanctions] = await Promise.all([
      this.periodMetrics(range.from, range.to, range.fromDate, range.toExclusive),
      this.periodMetrics(
        range.previousFrom,
        range.previousTo,
        range.previousFromDate,
        range.previousToExclusive,
      ),
      this.activityMetrics(now),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.report.count({ where: { status: ReportStatus.PENDING } }),
      this.prisma.userSanction.groupBy({
        by: ['type'],
        where: activeSanctionWhere(now),
        _count: { _all: true },
      }),
    ]);

    const sanctionCount = (type: UserSanctionType) =>
      sanctions.find((item) => item.type === type)?._count._all ?? 0;

    return {
      range: this.publicRange(range),
      activity,
      current,
      previous,
      snapshot: {
        totalUsers,
        pendingReports,
        activeSuspensions: sanctionCount(UserSanctionType.SUSPENSION),
        activeBans: sanctionCount(UserSanctionType.BAN),
      },
    };
  }

  async timeseries(query: AdminDashboardRangeQueryDto, now = new Date()) {
    const range = this.resolveRange(query, now);
    const rows = await this.prisma.$queryRaw<TimeseriesRow[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          CAST(${range.from} AS date),
          CAST(${range.to} AS date),
          interval '1 day'
        )::date AS day
      ), activity AS (
        SELECT CAST(date_key AS date) AS day, COUNT(*)::int AS dau
        FROM user_daily_activities
        WHERE date_key >= ${range.from} AND date_key <= ${range.to}
        GROUP BY CAST(date_key AS date)
      ), registrations AS (
        SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date AS day,
               COUNT(*)::int AS count
        FROM users
        WHERE created_at >= ${range.fromDate} AND created_at < ${range.toExclusive}
        GROUP BY 1
      ), published_threads AS (
        SELECT (published_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date AS day,
               COUNT(*)::int AS count
        FROM threads
        WHERE published = true
          AND published_at >= ${range.fromDate} AND published_at < ${range.toExclusive}
        GROUP BY 1
      ), new_posts AS (
        SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date AS day,
               COUNT(*)::int AS count
        FROM posts
        WHERE kind = CAST(${PostKind.FLOOR} AS "PostKind")
          AND created_at >= ${range.fromDate} AND created_at < ${range.toExclusive}
        GROUP BY 1
      ), received_reports AS (
        SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date AS day,
               COUNT(*)::int AS count
        FROM reports
        WHERE created_at >= ${range.fromDate} AND created_at < ${range.toExclusive}
        GROUP BY 1
      ), handled_reports AS (
        SELECT (handled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date AS day,
               COUNT(*)::int AS count
        FROM reports
        WHERE handled_at >= ${range.fromDate} AND handled_at < ${range.toExclusive}
        GROUP BY 1
      )
      SELECT days.day,
             COALESCE(activity.dau, 0)::int AS "dau",
             COALESCE(registrations.count, 0)::int AS "newUsers",
             COALESCE(published_threads.count, 0)::int AS "publishedThreads",
             COALESCE(new_posts.count, 0)::int AS "newPosts",
             COALESCE(received_reports.count, 0)::int AS "reportsReceived",
             COALESCE(handled_reports.count, 0)::int AS "reportsHandled"
      FROM days
      LEFT JOIN activity USING (day)
      LEFT JOIN registrations USING (day)
      LEFT JOIN published_threads USING (day)
      LEFT JOIN new_posts USING (day)
      LEFT JOIN received_reports USING (day)
      LEFT JOIN handled_reports USING (day)
      ORDER BY days.day ASC
    `);

    return {
      range: this.publicRange(range),
      items: rows.map((row) => ({
        date: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
        dau: numeric(row.dau),
        newUsers: numeric(row.newUsers),
        publishedThreads: numeric(row.publishedThreads),
        newPosts: numeric(row.newPosts),
        reportsReceived: numeric(row.reportsReceived),
        reportsHandled: numeric(row.reportsHandled),
      })),
    };
  }

  async distributions(now = new Date()) {
    const [users, reportsByStatus, reportsByReason, threads, categories, sanctions] =
      await Promise.all([
        this.prisma.user.groupBy({
          by: ['role'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.report.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.report.groupBy({ by: ['reasonCode'], _count: { _all: true } }),
        this.prisma.thread.groupBy({
          by: ['category'],
          where: { published: true, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.threadCategoryDefinition.findMany({
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { slug: true },
        }),
        this.prisma.userSanction.groupBy({
          by: ['type'],
          where: activeSanctionWhere(now),
          _count: { _all: true },
        }),
      ]);

    return {
      usersByRole: Object.values(UserRole).map((key) => ({
        key,
        count: users.find((item) => item.role === key)?._count._all ?? 0,
      })),
      reportsByStatus: Object.values(ReportStatus).map((key) => ({
        key,
        count: reportsByStatus.find((item) => item.status === key)?._count._all ?? 0,
      })),
      reportsByReason: Object.values(ReportReasonCode).map((key) => ({
        key,
        count: reportsByReason.find((item) => item.reasonCode === key)?._count._all ?? 0,
      })),
      threadsByCategory: categories.map(({ slug: key }) => ({
        key,
        count: threads.find((item) => item.category === key)?._count._all ?? 0,
      })),
      activeSanctionsByType: Object.values(UserSanctionType).map((key) => ({
        key,
        count: sanctions.find((item) => item.type === key)?._count._all ?? 0,
      })),
    };
  }

  private async periodMetrics(from: string, to: string, fromDate: Date, toExclusive: Date) {
    const [activeRows, newUsers, publishedThreads, newPosts, reportsReceived, reportsHandled] =
      await Promise.all([
        this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(DISTINCT user_id) AS count
          FROM user_daily_activities
          WHERE date_key >= ${from} AND date_key <= ${to}
        `),
        this.prisma.user.count({ where: { createdAt: { gte: fromDate, lt: toExclusive } } }),
        this.prisma.thread.count({
          where: {
            published: true,
            publishedAt: { gte: fromDate, lt: toExclusive },
          },
        }),
        this.prisma.post.count({
          where: { kind: PostKind.FLOOR, createdAt: { gte: fromDate, lt: toExclusive } },
        }),
        this.prisma.report.count({ where: { createdAt: { gte: fromDate, lt: toExclusive } } }),
        this.prisma.report.count({
          where: { handledAt: { gte: fromDate, lt: toExclusive } },
        }),
      ]);

    return {
      activeUsers: numeric(activeRows[0]?.count),
      newUsers,
      publishedThreads,
      newPosts,
      reportsReceived,
      reportsHandled,
    };
  }

  private async activityMetrics(now: Date) {
    const today = analyticsDateKey(now);
    const weekStart = addDateKeyDays(today, -6);
    const monthStart = addDateKeyDays(today, -29);
    const rows = await this.prisma.$queryRaw<
      Array<{ dau: bigint | number; wau: bigint | number; mau: bigint | number }>
    >(Prisma.sql`
      SELECT COUNT(DISTINCT user_id) FILTER (WHERE date_key = ${today}) AS dau,
             COUNT(DISTINCT user_id) FILTER (WHERE date_key >= ${weekStart}) AS wau,
             COUNT(DISTINCT user_id) AS mau
      FROM user_daily_activities
      WHERE date_key >= ${monthStart} AND date_key <= ${today}
    `);
    return {
      dau: numeric(rows[0]?.dau),
      wau: numeric(rows[0]?.wau),
      mau: numeric(rows[0]?.mau),
    };
  }

  private resolveRange(query: AdminDashboardRangeQueryDto, now: Date): DashboardRange {
    const today = analyticsDateKey(now);
    const to = query.to ?? today;
    const from = query.from ?? addDateKeyDays(to, -(DEFAULT_RANGE_DAYS - 1));
    if (!isValidDateKey(from) || !isValidDateKey(to)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '日期必须是有效的 YYYY-MM-DD');
    }
    const distance = dateKeyDistance(from, to);
    if (distance < 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'from 不能晚于 to');
    }
    const days = distance + 1;
    if (days > MAX_RANGE_DAYS) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, `统计区间不能超过 ${MAX_RANGE_DAYS} 天`);
    }
    const previousFrom = addDateKeyDays(from, -days);
    const previousTo = addDateKeyDays(from, -1);
    return {
      from,
      to,
      previousFrom,
      previousTo,
      timezone: ANALYTICS_TIME_ZONE,
      fromDate: analyticsDayStart(from),
      toExclusive: analyticsDayStart(addDateKeyDays(to, 1)),
      previousFromDate: analyticsDayStart(previousFrom),
      previousToExclusive: analyticsDayStart(from),
    };
  }

  private publicRange(range: DashboardRange) {
    return {
      from: range.from,
      to: range.to,
      previousFrom: range.previousFrom,
      previousTo: range.previousTo,
      timezone: range.timezone,
    };
  }
}
