'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { serviceProperties, systemdArguments } = require('./font-sandbox-preflight.cjs');
const unit = fs.readFileSync(path.join(__dirname, '../ops/wenyousite-font-worker.service'), 'utf8');

test('真实 unit 防护全部进入独立探针，生产环境和业务命令不进入探针', () => {
  const properties = serviceProperties(unit);
  const args = systemdArguments(properties, {
    unitName: 'synthetic.service',
    backendDir: '/synthetic/repo',
    probeRoot: '/synthetic/probe',
    nodeBinary: '/usr/bin/node',
    toolchain: '/synthetic/toolchain',
  });
  for (const property of properties) assert(args.includes(`--property=${property}`));
  assert(args.includes('--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK'));
  assert(args.includes('--property=CapabilityBoundingSet='));
  assert(args.includes('--property=ProtectKernelTunables=false'));
  assert(args.includes('--property=ProtectKernelLogs=false'));
  assert(args.includes('--property=ReadWritePaths=/synthetic/probe'));
  assert(!args.some((arg) => /backend\.env|dist\/font-worker|\/var\/log\/wenyousite/u.test(arg)));
  assert.deepEqual(args.slice(args.indexOf('/usr/bin/env'), args.indexOf('/usr/bin/node')), [
    '/usr/bin/env',
    '-i',
    'PATH=/usr/bin:/bin',
    'LANG=C.UTF-8',
  ]);
});

test('拒绝未分类、重复和多行属性，避免未来 unit 变化被预检漏掉', () => {
  for (const added of [
    'SystemCallFilter=@system-service',
    'PrivateTmp=false',
    'ReadOnlyPaths=/a \\\n /b',
  ]) {
    assert.throws(() => serviceProperties(unit.replace('[Service]', `[Service]\n${added}`)));
  }
});

test('丢失边界或增加进程能力时阻止预检', () => {
  for (const [before, after] of [
    ['MemoryMax=3G\n', ''],
    ['NoNewPrivileges=true', 'NoNewPrivileges=false'],
    ['CapabilityBoundingSet=', 'CapabilityBoundingSet=CAP_SYS_ADMIN'],
    ['AmbientCapabilities=', 'AmbientCapabilities=CAP_NET_ADMIN'],
    ['User=wenyousite-backend', 'User=root'],
  ])
    assert.throws(() => serviceProperties(unit.replace(before, after)));
});

test('历史缺失 AF_NETLINK 和 proc 屏蔽配置不会被预检私自改好', () => {
  const historical = unit
    .replace(' AF_NETLINK', '')
    .replace('ProtectKernelTunables=false', 'ProtectKernelTunables=true')
    .replace('ProtectKernelLogs=false', 'ProtectKernelLogs=true');
  const properties = serviceProperties(historical);
  assert(properties.includes('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'));
  assert(properties.includes('ProtectKernelTunables=true'));
  assert(properties.includes('ProtectKernelLogs=true'));
});
