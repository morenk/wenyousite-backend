import { addDateKeyDays, analyticsDateKey, dateKeyDistance, isValidDateKey } from './activity-date';

describe('activity date helpers', () => {
  it('uses the Asia/Shanghai calendar boundary', () => {
    expect(analyticsDateKey(new Date('2026-08-07T16:00:00.000Z'))).toBe('2026-08-08');
  });

  it('validates and moves date keys without host timezone influence', () => {
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2028-02-29')).toBe(true);
    expect(addDateKeyDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(dateKeyDistance('2025-12-31', '2026-01-02')).toBe(2);
  });
});
