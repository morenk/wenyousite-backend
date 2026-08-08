export const ANALYTICS_TIME_ZONE = 'Asia/Shanghai';
export const ANALYTICS_UTC_OFFSET = '+08:00';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 将时间转成管理看板统一使用的北京时间日期键。 */
export function analyticsDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 日期键运算固定在 UTC 日历上，避免宿主机时区影响 YYYY-MM-DD。 */
export function addDateKeyDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateKeyDistance(from: string, to: string): number {
  const fromTime = new Date(`${from}T00:00:00Z`).getTime();
  const toTime = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor((toTime - fromTime) / 86_400_000);
}

export function analyticsDayStart(value: string): Date {
  return new Date(`${value}T00:00:00${ANALYTICS_UTC_OFFSET}`);
}
