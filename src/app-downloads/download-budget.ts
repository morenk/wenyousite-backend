import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, fsyncSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertDownload, DownloadFailure } from './download-model';
import {
  DEFAULT_QUOTA_LIMITS,
  DownloadQuota,
  DownloadQuotaLimits,
  DownloadVisitor,
  initializeQuotaSchema,
  readDeviceKeys,
} from './download-quota';
import { DEVICE_COOKIE_SECONDS, freshSigningKey } from './download-device';

function boundLedger(db: DatabaseSync) {
  assertDownload(Number(db.prepare('PRAGMA page_size').get()?.page_size) === 4096);
  assertDownload(Number(db.prepare('PRAGMA max_page_count=16384').get()?.max_page_count) === 16384);
  db.exec('PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=1048576;');
}

export function beijingPeriods(now: number) {
  const shifted = new Date(now + 8 * 3600_000).toISOString();
  const day = shifted.slice(0, 10),
    month = shifted.slice(0, 7);
  const nextDay = Date.parse(`${day}T00:00:00.000Z`) + 16 * 3600_000;
  const year = Number(month.slice(0, 4)),
    m = Number(month.slice(5));
  const nextMonth = Date.UTC(year, m, 1) - 8 * 3600_000;
  return {
    day,
    month,
    dayRetry: Math.max(1, Math.ceil((nextDay - now) / 1000)),
    monthRetry: Math.max(1, Math.ceil((nextMonth - now) / 1000)),
  };
}

export function validateBudgetPath(path: string) {
  assertDownload(realpathSync(dirname(path)) === resolve(dirname(path)));
  const directory = lstatSync(dirname(path));
  assertDownload(directory.isDirectory() && (directory.mode & 0o077) === 0);
  const file = lstatSync(path);
  assertDownload(
    file.isFile() && !file.isSymbolicLink() && file.nlink === 1 && (file.mode & 0o077) === 0,
  );
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      const s = lstatSync(path + suffix);
      assertDownload(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && (s.mode & 0o077) === 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export class DownloadBudget {
  private readonly db: DatabaseSync;
  private readonly identity: string;
  private readonly quota?: DownloadQuota;
  constructor(
    private readonly path: string,
    readonly kind: 'egress' | 'origin',
    private readonly limits: { day: number; month: number },
    quotaLimits: DownloadQuotaLimits = DEFAULT_QUOTA_LIMITS,
  ) {
    validateBudgetPath(path);
    const stat = lstatSync(path);
    this.identity = `${stat.dev}:${stat.ino}`;
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      this.db.exec(
        'PRAGMA busy_timeout=100; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;',
      );
      const metadata = this.db.prepare('SELECT version, kind FROM identity').get();
      assertDownload(
        metadata?.kind === kind &&
          (metadata.version === 1 || (kind === 'egress' && metadata.version === 2)),
      );
      assertDownload(this.db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok');
      if (kind === 'egress' && metadata.version === 2) {
        boundLedger(this.db);
        this.quota = new DownloadQuota(this.db, quotaLimits);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  static initialize(path: string, kind: 'egress' | 'origin') {
    assertDownload(realpathSync(dirname(path)) === resolve(dirname(path)));
    assertDownload((lstatSync(dirname(path)).mode & 0o077) === 0);
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    fsyncSync(fd);
    closeSync(fd);
    validateBudgetPath(path);
    const db = new DatabaseSync(path);
    try {
      db.exec(
        'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE identity(version INTEGER NOT NULL,kind TEXT NOT NULL); CREATE TABLE counters(period TEXT PRIMARY KEY, bytes INTEGER NOT NULL CHECK(bytes >= 0)); CREATE TABLE clock(last_ms INTEGER NOT NULL); INSERT INTO clock VALUES(0);',
      );
      db.prepare('INSERT INTO identity VALUES(?,?)').run(kind === 'egress' ? 2 : 1, kind);
      if (kind === 'egress') initializeQuotaSchema(db);
      db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
    } finally {
      db.close();
    }
    const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    fsyncSync(parent);
    closeSync(parent);
  }
  /** 只允许管理 CLI 在取得离线网关锁后执行；保留 v1 字节累计与原时钟，不重建账本。 */
  static upgradeEgress(path: string) {
    validateBudgetPath(path);
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=100; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      assertDownload(db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok');
      boundLedger(db);
      db.exec('BEGIN IMMEDIATE');
      try {
        const identity = db.prepare('SELECT version,kind FROM identity').get();
        assertDownload(identity?.kind === 'egress' && [1, 2].includes(Number(identity.version)));
        if (identity.version === 1) {
          initializeQuotaSchema(db);
          db.exec('UPDATE identity SET version=2');
        }
        readDeviceKeys(db);
        db.prepare('SELECT day,kind,subject,downloads FROM download_counts LIMIT 1').get();
        db.prepare('SELECT day,subjects FROM download_count_days LIMIT 1').get();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }
  deviceKeys() {
    assertDownload(this.quota);
    return readDeviceKeys(this.db);
  }
  rotateDeviceKey(now = Date.now()) {
    assertDownload(this.quota);
    this.assertCurrent(now);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertClock(now);
      const keys = readDeviceKeys(this.db),
        seconds = Math.floor(now / 1000);
      assertDownload(!keys.previous || keys.previous.until <= seconds);
      const next = {
        ...keys,
        active: freshSigningKey(),
        previous: { ...keys.active, until: seconds + DEVICE_COOKIE_SECONDS },
      };
      this.db
        .prepare('UPDATE download_device_keys SET value=? WHERE singleton=1')
        .run(JSON.stringify(next));
      this.db.prepare('UPDATE clock SET last_ms=?').run(now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  reserve(bytes: number, now = Date.now()) {
    this.reserveTransaction(bytes, now);
  }
  reserveFile(bytes: number, visitor: DownloadVisitor, now = Date.now()) {
    assertDownload(this.quota && bytes > 0);
    this.reserveTransaction(bytes, now, visitor);
  }
  preflightFile(bytes: number, visitor: DownloadVisitor, now = Date.now()) {
    assertDownload(this.quota && Number.isSafeInteger(bytes) && bytes > 0);
    this.assertCurrent(now);
    this.db.exec('BEGIN');
    try {
      this.assertClock(now);
      const period = beijingPeriods(now);
      this.quota.check(visitor, period.day, period.dayRetry);
      this.checkBytes(bytes, period);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private assertCurrent(now: number) {
    assertDownload(Number.isSafeInteger(now) && now >= 0);
    validateBudgetPath(this.path);
    const stat = lstatSync(this.path);
    assertDownload(`${stat.dev}:${stat.ino}` === this.identity);
  }
  private assertClock(now: number) {
    const clock = this.db.prepare('SELECT last_ms FROM clock').get();
    assertDownload(clock && now >= Number(clock.last_ms));
  }
  private checkBytes(bytes: number, period: ReturnType<typeof beijingPeriods>) {
    const read = this.db.prepare('SELECT bytes FROM counters WHERE period=?');
    for (const [key, limit, retry] of [
      [period.day, this.limits.day, period.dayRetry],
      [period.month, this.limits.month, period.monthRetry],
    ] as const) {
      if (Number(read.get(key)?.bytes ?? 0) + bytes > limit)
        throw new DownloadFailure(429, retry, 'budget');
    }
  }
  private reserveTransaction(bytes: number, now: number, visitor?: DownloadVisitor) {
    assertDownload(Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(now));
    this.assertCurrent(now);
    const period = beijingPeriods(now);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // 时钟回拨可能重用旧窗口，拒绝直到追平，不能隐式重置预算。
      this.assertClock(now);
      this.quota?.prune(period.day);
      if (visitor) this.quota!.check(visitor, period.day, period.dayRetry);
      this.checkBytes(bytes, period);
      if (visitor) this.quota!.reserve(visitor, period.day, period.dayRetry);
      for (const key of [period.day, period.month])
        this.db
          .prepare(
            'INSERT INTO counters VALUES(?,?) ON CONFLICT(period) DO UPDATE SET bytes=bytes+excluded.bytes',
          )
          .run(key, bytes);
      this.db.prepare('UPDATE clock SET last_ms=?').run(now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  available(bytes: number, now = Date.now()): number | null {
    const p = beijingPeriods(now),
      status = this.status(now);
    if (status.monthReservedBytes + bytes > this.limits.month) return p.monthRetry;
    if (status.dayReservedBytes + bytes > this.limits.day) return p.dayRetry;
    return null;
  }
  status(now = Date.now()) {
    validateBudgetPath(this.path);
    const stat = lstatSync(this.path);
    assertDownload(`${stat.dev}:${stat.ino}` === this.identity);
    assertDownload(now >= Number(this.db.prepare('SELECT last_ms FROM clock').get()?.last_ms));
    const p = beijingPeriods(now);
    const read = this.db.prepare('SELECT bytes FROM counters WHERE period=?');
    return {
      kind: this.kind,
      day: p.day,
      month: p.month,
      dayReservedBytes: Number(read.get(p.day)?.bytes ?? 0),
      monthReservedBytes: Number(read.get(p.month)?.bytes ?? 0),
    };
  }
  close() {
    this.db.close();
  }
}

/** 独立 SQLite 排他事务由内核释放；不同 socket 也不能复用同一账本启动第二实例。 */
export class DownloadInstanceLock {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    validateBudgetPath(path);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;');
      assertDownload(this.db.prepare('SELECT version FROM identity').get()?.version === 1);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.exec('ROLLBACK');
    this.db.close();
  }
  static initialize(path: string) {
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    fsyncSync(fd);
    closeSync(fd);
    validateBudgetPath(path);
    const db = new DatabaseSync(path);
    try {
      db.exec(
        'PRAGMA synchronous=FULL; CREATE TABLE identity(version INTEGER NOT NULL); INSERT INTO identity VALUES(1);',
      );
    } finally {
      db.close();
    }
    const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    fsyncSync(parent);
    closeSync(parent);
  }
}
