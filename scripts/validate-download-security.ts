import assert from 'node:assert/strict';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateDownloadUnit(unit: string) {
  const settings = new Map<string, string[]>();
  for (const line of unit.split('\n')) { const match = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line); if (match) settings.set(match[1], [...settings.get(match[1]) ?? [], match[2]]); }
  const one = (key: string, value: string) => assert.deepEqual(settings.get(key), [value], key);
  one('User', 'wenyousite-download'); one('Group', 'wenyousite-download-proxy'); one('SupplementaryGroups', 'wenyousite-download-cache');
  for (const key of ['PrivateNetwork', 'NoNewPrivileges', 'ProtectHome', 'ProtectClock', 'PrivateDevices']) one(key, 'true');
  one('RestrictAddressFamilies', 'AF_UNIX'); one('ProtectSystem', 'strict'); one('MemoryMax', '256M'); one('MemoryHigh', '192M'); one('CPUQuota', '50%');
  one('ReadOnlyPaths', '/var/cache/wenyousite-download /var/lib/wenyousite-download/catalog');
  one('ReadWritePaths', '/var/lib/wenyousite-download/egress /run/wenyousite-download');
  one('InaccessiblePaths', '/etc/wenyousite/backend.env /etc/wenyousite/download-origin.env /etc/wenyousite/migration.env /var/lib/wenyousite-download/origin /var/lib/wenyousite-download/inbox');
  one('ExecStart', '/var/lib/wenyousite/backend/current/bin/node --max-old-space-size=128 /var/lib/wenyousite/backend/current/dist/app-downloads/download-main.js --env /etc/wenyousite/download.env');
  one('RuntimeDirectory', 'wenyousite-download'); one('RuntimeDirectoryMode', '0750'); one('RuntimeDirectoryPreserve', 'no'); one('UMask', '0077');
  assert(!settings.has('Environment') && !settings.has('EnvironmentFile') && !settings.has('ExecStartPre') && !settings.has('ExecStartPost'));
}
export function validateInstalledConfig(path: string) {
  const file = lstatSync(path); assert(file.isFile() && !file.isSymbolicLink() && file.uid === 0 && (file.mode & 0o027) === 0 && realpathSync(path) === resolve(path));
  const text = readFileSync(path, 'utf8'); assert(!/(?:AWS_|COS_|DATABASE_URL|REDIS_|S3_)/.test(text));
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    assert(args.length <= 1 && (!args.length || args[0] === '--installed'));
    validateDownloadUnit(readFileSync(args.length ? '/etc/systemd/system/wenyousite-download.service' : 'ops/wenyousite-download.service', 'utf8'));
    if (args.length) validateInstalledConfig('/etc/wenyousite/download.env');
    console.log('Download security template passed');
  } catch { console.error('DOWNLOAD_SECURITY_FAILED'); process.exitCode = 1; }
}
