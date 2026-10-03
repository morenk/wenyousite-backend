import { createHmac } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DOWNLOAD_LIMITS } from './app-download.contract';
import { deviceKeysSchema, DeviceKeys, freshDeviceKeys } from './download-device';
import { assertDownload, DownloadFailure } from './download-model';

export interface DownloadVisitor {
  ip: string;
  device: string;
}
export interface DownloadQuotaLimits {
  device: number;
  ip: number;
  subjects: number;
}
export const DEFAULT_QUOTA_LIMITS: DownloadQuotaLimits = {
  device: DOWNLOAD_LIMITS.deviceDownloadsPerDay,
  ip: DOWNLOAD_LIMITS.ipDownloadsPerDay,
  subjects: DOWNLOAD_LIMITS.quotaSubjectsPerDay,
};
export function initializeQuotaSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE download_device_keys (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL);
    CREATE TABLE download_counts (day TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('device','ip')), subject TEXT NOT NULL CHECK(length(subject)=64), downloads INTEGER NOT NULL CHECK(downloads>0), PRIMARY KEY(day,kind,subject)) WITHOUT ROWID;
    CREATE TABLE download_count_days (day TEXT PRIMARY KEY, subjects INTEGER NOT NULL CHECK(subjects>=0)) WITHOUT ROWID;`);
  db.prepare('INSERT INTO download_device_keys VALUES(1,?)').run(JSON.stringify(freshDeviceKeys()));
}
export function readDeviceKeys(db: DatabaseSync): DeviceKeys {
  const value = db.prepare('SELECT value FROM download_device_keys WHERE singleton=1').get()?.value;
  assertDownload(typeof value === 'string' && value.length < 2048);
  return deviceKeysSchema.parse(JSON.parse(value));
}

export class DownloadQuota {
  readonly keys: DeviceKeys;
  constructor(
    private readonly db: DatabaseSync,
    private readonly limits: DownloadQuotaLimits,
  ) {
    this.keys = readDeviceKeys(db);
    assertDownload(
      [limits.device, limits.ip, limits.subjects].every((v) => Number.isSafeInteger(v) && v > 0),
    );
  }
  private subjects(visitor: DownloadVisitor, day: string) {
    assertDownload(visitor.ip.length <= 64 && /^[A-Za-z0-9_-]{43}$/.test(visitor.device));
    return (['device', 'ip'] as const).map((kind) => ({
      kind,
      subject: createHmac('sha256', Buffer.from(this.keys.hashKey, 'hex'))
        .update(`${day}:${kind}:${visitor[kind]}`)
        .digest('hex'),
    }));
  }
  /** 调用者持有与字节账本共用的 SQLite 事务；这里从不单独提交。 */
  check(visitor: DownloadVisitor, day: string, retryAfter: number) {
    const subjects = this.subjects(visitor, day);
    const read = this.db.prepare(
      'SELECT downloads FROM download_counts WHERE day=? AND kind=? AND subject=?',
    );
    let added = 0;
    for (const { kind, subject } of subjects) {
      const row = read.get(day, kind, subject);
      if (Number(row?.downloads ?? 0) >= this.limits[kind])
        throw new DownloadFailure(
          429,
          retryAfter,
          kind === 'device' ? 'device_daily_limit' : 'ip_daily_limit',
        );
      if (!row) added++;
    }
    const current = Number(
      this.db.prepare('SELECT subjects FROM download_count_days WHERE day=?').get(day)?.subjects ??
        0,
    );
    if (current + added > this.limits.subjects) throw new DownloadFailure(503, retryAfter);
    return { subjects, added };
  }
  reserve(visitor: DownloadVisitor, day: string, retryAfter: number) {
    const { subjects, added } = this.check(visitor, day, retryAfter);
    const upsert = this.db.prepare(
      'INSERT INTO download_counts VALUES(?,?,?,1) ON CONFLICT(day,kind,subject) DO UPDATE SET downloads=downloads+1',
    );
    for (const { kind, subject } of subjects) upsert.run(day, kind, subject);
    this.db
      .prepare(
        'INSERT INTO download_count_days VALUES(?,?) ON CONFLICT(day) DO UPDATE SET subjects=subjects+excluded.subjects',
      )
      .run(day, added);
  }
  prune(day: string) {
    this.db.prepare('DELETE FROM download_counts WHERE day < ?').run(day);
    this.db.prepare('DELETE FROM download_count_days WHERE day < ?').run(day);
  }
}
