const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

// 把实际导出目标设为目录；EISDIR 在 root/普通用户下均成立，不依赖权限绕过。
const directory = mkdtempSync(join(tmpdir(), 'wenyousite-openapi-export-failure.'));
try {
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', 'scripts/export-openapi.ts', directory], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 45_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      TS_NODE_FILES: 'true',
      DATABASE_URL: 'postgresql://test:test@example.invalid/wenyousite',
      DIRECT_DATABASE_URL: 'postgresql://test:test@example.invalid/wenyousite',
    },
  });
  assert.equal(result.error, undefined, '真实导出错误后没有及时退出（可能保留 Nest 后台句柄）');
  assert.equal(result.signal, null);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /EISDIR/);
  console.log('OpenAPI 真实写入失败及时退出测试通过');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
