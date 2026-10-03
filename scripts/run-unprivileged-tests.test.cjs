const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const { resolve, join } = require('node:path');
const { test } = require('node:test');

const repo = resolve(__dirname, '..');
const launcher = join(__dirname, 'run-unprivileged-tests.cjs');
const expectedUid = process.getuid() === 0 ? fs.statSync(repo).uid : process.getuid();
const probe = `
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const {spawnSync} = require('node:child_process');
  const root = process.env.WENYOU_TEST_ROOT;
  const ownership = JSON.parse(fs.readFileSync(root + '/ownership.json', 'utf8'));
  assert(process.getuid() > 0 && process.geteuid() === process.getuid());
  assert.equal(process.getuid(), ownership.uid);
  assert.equal(process.env.WENYOU_TEST_RUN_ID, ownership.runId);
  assert.equal(process.env.E2E_RUN_ID, ownership.runId);
  assert.equal(process.env.E2E_RESOURCE_ROOT, root);
  assert.equal(require('node:os').tmpdir(), root);
  assert.equal(fs.statSync(root).uid, process.getuid());
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  for (const key of ['DATABASE_URL','REDIS_PASSWORD','AWS_ACCESS_KEY_ID','PREVIEW_STATE_ROOT','NODE_OPTIONS','NODE_PATH']) {
    assert.equal(process.env[key], undefined);
  }
  const child = spawnSync(process.execPath, ['-p','process.getuid()'], {encoding:'utf8'});
  assert.equal(child.status, 0);
  assert.equal(Number(child.stdout), process.getuid());
  fs.writeFileSync(root + '/fixture', 'synthetic', {mode:0o600});
  console.log(JSON.stringify({uid:process.getuid(),groups:process.getgroups(),root,runId:ownership.runId}));
`;

function run(script) {
  return spawnSync(process.execPath, [launcher, '-e', script], {
    cwd: repo,
    env: {
      ...process.env,
      DATABASE_URL: 'synthetic-must-not-inherit',
      REDIS_PASSWORD: 'synthetic-must-not-inherit',
      AWS_ACCESS_KEY_ID: 'synthetic-must-not-inherit',
      PREVIEW_STATE_ROOT: '/synthetic-must-not-inherit',
      E2E_RESOURCE_ROOT: '/synthetic-must-not-inherit',
      NODE_OPTIONS: '--max-old-space-size=128',
      NODE_PATH: '/synthetic-must-not-inherit',
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('测试子进程使用真实非 root 身份、独立私有目录及无凭据环境，结束仅回收本轮目录', () => {
  const results = [run(probe), run(probe)];
  const roots = [];
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.uid, expectedUid);
    if (process.getuid() === 0) assert(!data.groups.includes(0));
    assert(!fs.existsSync(data.root));
    assert.match(result.stderr, /isolated-tests-cleaned/);
    roots.push(data.root);
  }
  assert.notEqual(roots[0], roots[1]);
});

test(
  '启动器收到 TERM 时回收真实 Node 测试及活跃后代，不触及无关进程组',
  { timeout: 30000 },
  async () => {
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    const runner = spawn(
      process.execPath,
      [launcher, '--test', join(__dirname, 'run-unprivileged-tests.fixture.cjs')],
      { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const finished = once(runner, 'exit');
    let output = '';
    let errors = '';
    runner.stderr.on('data', (chunk) => (errors += chunk));
    try {
      const active = await new Promise((ok, fail) => {
        const timeout = setTimeout(
          () => fail(new Error('active descendant fixture timed out')),
          15000,
        );
        runner.once('error', (error) => {
          clearTimeout(timeout);
          fail(error);
        });
        runner.once('exit', () => {
          clearTimeout(timeout);
          fail(new Error('fixture exited before ready'));
        });
        runner.stdout.on('data', (chunk) => {
          output += chunk;
          const match = /WENYOU_ACTIVE_FIXTURE (\{[^\n]+\})/.exec(output);
          if (match) {
            clearTimeout(timeout);
            ok(JSON.parse(match[1]));
          }
        });
      });
      const identities = active.pids.map((pid) => ({
        pid,
        stat: fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' '),
      }));
      assert(fs.existsSync(active.root));
      runner.kill('SIGTERM');
      assert.equal((await finished)[0], 143, errors);
      assert(!fs.existsSync(active.root));
      for (const { pid, stat } of identities) {
        try {
          const current = fs
            .readFileSync(`/proc/${pid}/stat`, 'utf8')
            .split(') ')
            .at(-1)
            .split(' ');
          assert(current[19] !== stat[19] || ['Z', 'X'].includes(current[0]), '原后代进程仍存活');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      assert.equal(unrelated.exitCode, null);
      assert.equal(unrelated.signalCode, null);
      assert.match(errors, /isolated-tests-cleaned/);
    } finally {
      if (runner.exitCode === null && runner.signalCode === null) {
        runner.kill('SIGTERM');
        await finished;
      }
      const stopped = once(unrelated, 'exit');
      unrelated.kill('SIGTERM');
      await stopped;
    }
  },
);

test('测试失败和信号退出传回门禁且回收本轮目录', () => {
  for (const [ending, expected] of [
    ['process.exit(23)', 23],
    ["process.kill(process.pid, 'SIGTERM')", 143],
  ]) {
    const result = run(probe + ending);
    assert.equal(result.status, expected, result.stderr);
    assert(!fs.existsSync(JSON.parse(result.stdout).root));
    assert.match(result.stderr, /isolated-tests-cleaned/);
  }
});

test('管理身份运行时预览入口仍拒绝 root，降权不修改业务 guard', () => {
  const script =
    process.getuid() === 0
      ? `const assert=require('node:assert/strict');const {start,rebindWebPort}=require('./scripts/dev-preview/lifecycle');
      (async()=>{assert.equal(process.getuid(),0);await assert.rejects(()=>start('root-denied',{}),/禁止 root/);await assert.rejects(()=>rebindWebPort('root-denied',{}),/禁止 root/);})().catch(()=>{process.exitCode=1;});`
      : `require('node:assert/strict').ok(process.getuid()>0);`;
  const result = spawnSync(
    process.execPath,
    ['--require', 'ts-node/register/transpile-only', '-e', script],
    {
      cwd: repo,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
