import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { parse } from 'dotenv';
import { businessDate, environment, hash, privateDirectory, privateFile, Snapshot, writePrivate } from './common';

export function validateOrigin(origin: string) {
  const u = new URL(origin);
  assert(u.protocol === 'https:' && u.origin === origin && !u.username && !u.password && !u.port && !/^[\d.]+$/.test(u.hostname) && !u.hostname.includes(':'), '历史媒体必须为精确 HTTPS 域名');
}
export function validateHistoricalMap(map: Record<string, string>, origin: string) {
  validateOrigin(origin);
  for (const [key, value] of Object.entries(map)) {
    const u = new URL(value);
    assert(key && !key.startsWith('/') && !key.split('/').includes('..') && !/[\0\\]/.test(key), '历史对象键非法');
    assert(u.origin === origin && u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && decodeURIComponent(u.pathname).endsWith('/' + key), '历史媒体映射越界');
  }
}
export function readSnapshot(directory: string, requireToday = true): { metadata: Snapshot; media: Record<string,string>; dump: string } {
  const root = privateDirectory(resolve(directory));
  const info = JSON.parse(readFileSync(privateFile(join(root, 'snapshot.json')), 'utf8')) as Snapshot;
  assert(info.version === 1 && /^[a-f0-9]{64}$/.test(info.sha256) && /^[a-f0-9]{40}$/.test(info.sourceSha) && info.migrationVersion, '快照登记非法');
  assert(Number.isFinite(Date.parse(info.capturedAt)) && businessDate(new Date(info.capturedAt)) === info.businessDate, '快照时间不符');
  assert(!requireToday || info.businessDate === businessDate(), '新会话仅接受北京时间当天快照');
  const dump = privateFile(join(root, 'database.dump'));
  const mediaFile = privateFile(join(root, 'media.json'));
  assert(hash(readFileSync(dump)) === info.sha256 && hash(readFileSync(mediaFile)) === info.mediaSha256, '快照校验失败');
  const media = JSON.parse(readFileSync(mediaFile, 'utf8'));
  validateHistoricalMap(media, info.mediaOrigin);
  return { metadata: info, media, dump };
}

/** 必须与 dump 共用 PG 导出快照，避免对象映射来自另一事务时点。 */
export async function captureSnapshot(options: { output: string; sourceUrl: string; sourceSha: string; mediaOrigin: string; pgBin: string }) {
  assert(/^[a-f0-9]{40}$/.test(options.sourceSha), '需精确源 SHA');
  validateOrigin(options.mediaOrigin);
  const parent = privateDirectory(resolve(options.output), true);
  const capturedAt = new Date().toISOString();
  const date = businessDate(new Date(capturedAt));
  const target = join(parent, date);
  if (existsSync(target)) return readSnapshot(target).metadata;
  const staging = join(parent, '.capture-' + process.pid);
  mkdirSync(staging, { mode: 0o700 });
  const source = new URL(options.sourceUrl);
  const pgEnv = {PGHOST:source.hostname,PGPORT:source.port||'5432',PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:source.pathname.slice(1)};
  const db = new PrismaClient({ datasourceUrl: options.sourceUrl, log: [] });
  try {
    const data = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const rows = await tx.$queryRawUnsafe<Array<{ snapshot: string }>>('SELECT pg_export_snapshot() AS snapshot');
      const migrations = await tx.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1');
      assert(migrations[0], '缺少 migration 版本');
      execFileSync(join(options.pgBin, 'pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '--snapshot', rows[0].snapshot, '--file', join(staging, 'database.dump')], {
        env: { ...environment(), ...pgEnv, PGOPTIONS: '-c default_transaction_read_only=on' }, stdio: 'pipe',
      });
      const collected: Array<Record<string,unknown>> = [];
      const media: Record<string,string> = {};
      const add = (key: unknown, value: unknown) => {
        if (typeof key !== 'string' || typeof value !== 'string') return;
        try { validateHistoricalMap({ [key]: value }, options.mediaOrigin); media[key] = value; } catch { /* 外链不授予后台抓取权限。 */ }
      };
      const scan = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(scan);
        if (!value || typeof value !== 'object') return;
        const o = value as Record<string,unknown>;
        add(o.key, o.url); add(o.thumbnailKey, o.thumbnailUrl);
        for (const item of Object.values(o)) scan(item);
      };
      for (const row of await tx.media.findMany({ select: { key:true,url:true,posterUrl:true,previewVariants:true,displayAsset:true } })) {
        collected.push(row);
        scan(row);
        if (row.posterUrl) {
          const suffix = '/' + row.key;
          const prefix = row.url.endsWith(suffix) ? row.url.slice(0, -row.key.length) : '';
          if (prefix && row.posterUrl.startsWith(prefix)) add(decodeURIComponent(row.posterUrl.slice(prefix.length)), row.posterUrl);
        }
      }
      for (const row of await tx.stickerAsset.findMany()) {collected.push(row);scan(row);}
      const {mediaMap}=await import('./backup');
      Object.assign(media,mediaMap(collected,options.mediaOrigin));
      return { migrationVersion: migrations[0].migration_name, media };
    }, { timeout: 600000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const { chmodSync } = await import('node:fs');
    chmodSync(join(staging, 'database.dump'), 0o600);
    writePrivate(join(staging, 'media.json'), data.media);
    execFileSync(join(options.pgBin,'pg_restore'), ['--list',join(staging,'database.dump')], { env: environment(), stdio:'pipe' });
    const metadata: Snapshot = { version:1, capturedAt, businessDate:date, sha256:hash(readFileSync(join(staging,'database.dump'))), sourceSha:options.sourceSha, migrationVersion:data.migrationVersion, mediaSha256:hash(readFileSync(join(staging,'media.json'))), mediaOrigin:options.mediaOrigin };
    writePrivate(join(staging,'snapshot.json'),metadata);
    renameSync(staging,target);
    return metadata;
  } finally { await db.$disconnect(); }
}
export async function adminSnapshot(args: Record<string,string>) {
  assert(process.getuid?.() === 0, '真实快照导出仅允许审核后的管理入口');
  assert(args['source-env'] && args.output && args['source-sha'] && args['media-origin'] && args['pg-bin'] && args['publish-root'], '快照参数不完整');
  assert(/^[a-f0-9]{40}$/.test(args['source-sha']), '需精确源 SHA');
  validateOrigin(args['media-origin']);
  const {importDailyBackup,publishSnapshot}=await import('./backup');
  let result:Snapshot|undefined;
  const existing=join(resolve(args.output),businessDate());
  if(existsSync(existing)) result=readSnapshot(existing).metadata;
  else if(args['backup-root']) result=importDailyBackup({backupRoot:args['backup-root'],output:args.output,sourceSha:args['source-sha'],mediaOrigin:args['media-origin'],pgBin:args['pg-bin']});
  if(!result){
    const env = parse(readFileSync(privateFile(resolve(args['source-env']),0)));
    assert(env.DATABASE_URL, '源配置缺少 DATABASE_URL');
    result = await captureSnapshot({ output:args.output, sourceUrl:env.DATABASE_URL, sourceSha:args['source-sha'], mediaOrigin:args['media-origin'], pgBin:args['pg-bin'] });
  }
  publishSnapshot(args.output,args['publish-root'],result.businessDate);
  console.log(JSON.stringify({ businessDate: result.businessDate, capturedAt:result.capturedAt, sha256:result.sha256 }));
}
