const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { constants, tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

async function main() {
  assert(process.platform === 'linux', '测试隔离入口仅支持 Linux');
  assert(process.argv.length > 2, '缺少 Node 测试参数');
  const repo = fs.realpathSync(resolve(__dirname, '..'));
  const parentUid = process.getuid();
  assert.equal(parentUid, process.geteuid(), '调用者 real/effective UID 不一致');
  let uid = parentUid;
  let gid = process.getgid();
  if (parentUid === 0) {
    uid = fs.statSync(repo).uid;
    assert(uid > 0, 'root 测试必须使用非 root 开发身份所有的 checkout');
    const account = execFileSync('/usr/bin/getent', ['passwd', String(uid)], {
      env: { PATH: '/usr/bin:/bin' },
      encoding: 'utf8',
      maxBuffer: 4096,
    })
      .trim()
      .split(':');
    assert(account.length === 7 && Number(account[2]) === uid, 'checkout 属主无有效系统账号');
    gid = Number(account[3]);
    assert(Number.isSafeInteger(gid) && gid > 0, '测试主组不能为 root');
  }

  const root = fs.mkdtempSync(join(tmpdir(), 'wenyou-tests-'));
  fs.chmodSync(root, 0o700);
  const marker = join(root, 'ownership.json');
  const ownership = { runId: randomUUID(), root, uid, gid };
  fs.writeFileSync(marker, JSON.stringify(ownership), { mode: 0o600, flag: 'wx' });
  if (parentUid === 0) {
    fs.chownSync(marker, uid, gid);
    fs.chownSync(root, uid, gid);
  }
  const identity = fs.lstatSync(root);
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    TMPDIR: root,
    WENYOU_TEST_RUN_ID: ownership.runId,
    WENYOU_TEST_ROOT: root,
    E2E_RUN_ID: ownership.runId,
    E2E_RESOURCE_ROOT: root,
  };
  // 只降权测试子进程；不把部署的 Compose/云凭据或附加组带入测试。
  const command = parentUid === 0 ? '/usr/bin/setpriv' : process.execPath;
  const args =
    parentUid === 0
      ? [
          '--reuid',
          String(uid),
          '--regid',
          String(gid),
          '--clear-groups',
          '--no-new-privs',
          process.execPath,
          join(__dirname, 'run-unprivileged-test-worker.cjs'),
          ...process.argv.slice(2),
        ]
      : [join(__dirname, 'run-unprivileged-test-worker.cjs'), ...process.argv.slice(2)];
  console.error(
    JSON.stringify({ event: 'isolated-tests-start', parentUid, uid, gid, runId: ownership.runId }),
  );
  try {
    const child = spawn(command, args, { cwd: repo, env, stdio: ['ignore', 'inherit', 'inherit'] });
    let interrupted = 0;
    const interrupt = () => {
      interrupted ||= 130;
      child.kill('SIGINT');
    };
    const terminate = () => {
      interrupted ||= 143;
      child.kill('SIGTERM');
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      const code = await new Promise((ok, fail) => {
        child.once('error', fail);
        child.once('exit', (code, signal) => ok(code ?? 128 + (constants.signals[signal] || 1)));
      });
      process.exitCode = interrupted || code;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  } finally {
    const current = fs.lstatSync(root);
    assert(
      !current.isSymbolicLink() &&
        current.isDirectory() &&
        current.uid === uid &&
        current.dev === identity.dev &&
        current.ino === identity.ino,
      '测试目录身份变化，保留现场',
    );
    const file = fs.lstatSync(marker);
    assert(
      file.isFile() && !file.isSymbolicLink() && file.uid === uid && file.nlink === 1,
      '测试登记身份变化，保留现场',
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(marker, 'utf8')),
      ownership,
      '测试登记变化，保留现场',
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(join(root, 'processes-stopped.json'), 'utf8')),
      { runId: ownership.runId, stopped: true },
      '测试进程组未确认退出，保留现场',
    );
    fs.rmSync(root, { recursive: true });
    console.error(JSON.stringify({ event: 'isolated-tests-cleaned', runId: ownership.runId }));
  }
}

main().catch(() => {
  console.error(
    'ISOLATED_TEST_LAUNCH_FAILED: 检查 Linux 工具、checkout 非 root 属主及测试目录身份',
  );
  process.exitCode = 1;
});
