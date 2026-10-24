#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SECURITY_PROPERTIES = new Set([
  'User',
  'Group',
  'SupplementaryGroups',
  'NoNewPrivileges',
  'CapabilityBoundingSet',
  'AmbientCapabilities',
  'UMask',
  'PrivateTmp',
  'PrivateDevices',
  'ProtectHome',
  'ProtectSystem',
  'ProtectKernelTunables',
  'ProtectKernelModules',
  'ProtectKernelLogs',
  'ProtectControlGroups',
  'ProtectClock',
  'RestrictSUIDSGID',
  'LockPersonality',
  'RestrictAddressFamilies',
  'LimitNOFILE',
  'MemoryMax',
  'TasksMax',
  'TimeoutStopSec',
  'KillSignal',
]);
// 仅替换生命周期、日志和路径；新增 unit 指令须明确分类，不能静默遗漏保护属性。
const REPLACED_PROPERTIES = new Set([
  'Type',
  'WorkingDirectory',
  'EnvironmentFile',
  'ExecStart',
  'ExecStartPre',
  'Restart',
  'RestartSec',
  'ReadWritePaths',
  'StandardOutput',
  'StandardError',
]);

function serviceProperties(unit) {
  const values = new Map();
  let section;
  for (const raw of unit.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || /^[#;]/u.test(line)) continue;
    if (line.startsWith('[')) {
      section = line;
      continue;
    }
    if (section !== '[Service]') continue;
    const match = /^([A-Za-z]+)=(.*)$/u.exec(line);
    assert(match && !line.endsWith('\\'), '不支持的字体 Worker unit 语法');
    const [, key, value] = match;
    assert(
      SECURITY_PROPERTIES.has(key) || REPLACED_PROPERTIES.has(key),
      `未分类的 unit 属性: ${key}`,
    );
    assert(!values.has(key), `重复的 unit 属性: ${key}`);
    values.set(key, value);
  }
  for (const key of SECURITY_PROPERTIES) assert(values.has(key), `缺少 unit 属性: ${key}`);
  assert.equal(values.get('User'), 'wenyousite-backend');
  assert.equal(values.get('Group'), 'wenyousite-backend');
  assert.equal(values.get('NoNewPrivileges'), 'true');
  assert.equal(values.get('CapabilityBoundingSet'), '');
  assert.equal(values.get('AmbientCapabilities'), '');
  return [...values]
    .filter(([key]) => SECURITY_PROPERTIES.has(key))
    .map(([key, value]) => `${key}=${value}`);
}

function systemdArguments(properties, { unitName, backendDir, probeRoot, nodeBinary, toolchain }) {
  return [
    `--unit=${unitName}`,
    '--wait',
    '--pipe',
    '--collect',
    '--service-type=exec',
    ...properties.map((value) => `--property=${value}`),
    `--property=WorkingDirectory=${backendDir}`,
    `--property=ReadWritePaths=${probeRoot}`,
    '--property=RuntimeMaxSec=45s',
    '/usr/bin/env',
    '-i',
    'PATH=/usr/bin:/bin',
    'LANG=C.UTF-8',
    nodeBinary,
    path.join(backendDir, 'dist/text-fonts/font-sandbox-preflight.js'),
    probeRoot,
    toolchain,
  ];
}

function main() {
  assert.equal(process.getuid(), 0, 'systemd 字体预检须由管理身份运行');
  const args = process.argv.slice(2);
  assert(
    args.length === 0 || (args.length === 2 && args[0] === '--unit'),
    '用法: node scripts/font-sandbox-preflight.cjs [--unit FILE]',
  );
  const backendDir = path.resolve(__dirname, '..');
  const unitFile = args[1] ?? path.join(backendDir, 'ops/wenyousite-font-worker.service');
  const properties = serviceProperties(fs.readFileSync(unitFile, 'utf8'));
  const toolchain = fs.realpathSync(path.join(backendDir, '.cache/thread-font-toolchain'));
  fs.accessSync(path.join(toolchain, 'wenyou-toolchain.lock.json'));
  fs.accessSync(path.join(backendDir, 'dist/text-fonts/font-sandbox-preflight.js'));
  const cleanEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
  const uid = Number(
    execFileSync('/usr/bin/id', ['-u', 'wenyousite-backend'], {
      env: cleanEnv,
      encoding: 'utf8',
    }).trim(),
  );
  const gid = Number(
    execFileSync('/usr/bin/id', ['-g', 'wenyousite-backend'], {
      env: cleanEnv,
      encoding: 'utf8',
    }).trim(),
  );
  assert(Number.isInteger(uid) && uid > 0 && Number.isInteger(gid) && gid > 0);
  const probeRoot = fs.mkdtempSync('/var/lib/wenyousite/font-preflight-');
  const unitName = `wenyousite-font-preflight-${path.basename(probeRoot)}.service`;
  try {
    fs.chmodSync(probeRoot, 0o700);
    fs.chownSync(probeRoot, uid, gid);
    execFileSync(
      '/usr/bin/systemd-run',
      systemdArguments(properties, {
        unitName,
        backendDir,
        probeRoot,
        nodeBinary: process.execPath,
        toolchain,
      }),
      { env: cleanEnv, stdio: 'inherit', timeout: 90000 },
    );
  } finally {
    // 仅回收本次随机命名的探针；绝不启动、停止或重试业务 Worker。
    try {
      execFileSync('/usr/bin/systemctl', ['stop', unitName], {
        env: cleanEnv,
        stdio: 'ignore',
        timeout: 35000,
      });
    } catch {
      // --collect 已移除的 unit 返回非零；仍在运行的 unit 不得清理目录。
      const result = spawnSync(
        '/usr/bin/systemctl',
        ['is-active', unitName],
        { env: cleanEnv, encoding: 'utf8', timeout: 5000 },
      );
      assert(
        !result.error && ['inactive', 'failed', 'unknown'].includes(result.stdout.trim()),
        '探针未停止，保留目录',
      );
    }
    fs.rmSync(probeRoot, { recursive: true });
  }
}

module.exports = { serviceProperties, systemdArguments };
if (require.main === module) {
  try {
    main();
  } catch {
    console.error('字体 systemd 沙箱预检失败，拒绝继续部署');
    process.exitCode = 1;
  }
}
