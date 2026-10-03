const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { constants } = require('node:os');
const { join } = require('node:path');

async function main() {
  assert(process.getuid() > 0 && process.geteuid() === process.getuid());
  const root = process.env.WENYOU_TEST_ROOT;
  const ownership = JSON.parse(fs.readFileSync(join(root, 'ownership.json'), 'utf8'));
  assert.equal(ownership.root, root);
  assert.equal(ownership.uid, process.getuid());
  assert.equal(process.env.E2E_RUN_ID, ownership.runId);
  assert.equal(process.env.E2E_RESOURCE_ROOT, root);
  require('ts-node/register/transpile-only');
  const { processStart, stopOwnedGroup } = require('./e2e-processes');
  const child = spawn(process.execPath, process.argv.slice(2), {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const started = child.pid ? processStart(child.pid) : undefined;
  let stopping;
  let interrupted = 0;
  const stop = () =>
    (stopping ??= child.pid
      ? stopOwnedGroup(child.pid, ownership.runId, root, started)
      : Promise.resolve());
  const signal = (name) => {
    interrupted ||= 128 + constants.signals[name];
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  const interrupt = () => signal('SIGINT');
  const terminate = () => signal('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((ok, fail) => {
      child.once('error', fail);
      child.once('exit', (code, name) => ok(code ?? 128 + (constants.signals[name] || 1)));
    });
    process.exitCode = interrupted || code;
  } finally {
    try {
      await stop();
      fs.writeFileSync(
        join(root, 'processes-stopped.json'),
        JSON.stringify({ runId: ownership.runId, stopped: true }),
        { mode: 0o600, flag: 'wx' },
      );
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }
}

main().catch(() => {
  console.error('ISOLATED_TEST_WORKER_FAILED: 测试身份或进程组清理失败，保留本轮目录');
  process.exitCode = 1;
});
