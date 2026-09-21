import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { withResources, cleanEnvironment, stopChild } from './e2e-resources';
import { ownedGroup } from './e2e-processes';
const toolsEnv = Object.fromEntries(['E2E_PG_BIN', 'E2E_REDIS_BIN', 'E2E_LIBRARY_PATH'].map((k) => [k, process.env[k]]));
async function reaper(root: string, runId: string, apply: boolean) {
  const child = spawn(process.execPath, ['--import', require.resolve('tsx'), resolve('scripts/e2e-reap.ts'), '--root', root, '--run-id', runId, ...(apply ? ['--apply'] : [])], { env: cleanEnvironment(), stdio: 'ignore' });
  return new Promise((ok) => child.once('exit', ok));
}
async function signalCase(signal: 'SIGTERM' | 'SIGINT' | 'SIGKILL') {
  const supervisor = spawn(process.execPath, ['--import', require.resolve('tsx'), resolve('scripts/e2e-lifecycle.fixture.ts')], { env: { ...cleanEnvironment(), ...toolsEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((ok) => supervisor.once('exit', ok));
  let output = '';
  const data = await new Promise<{ root: string; runId: string }>((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error('fixture timeout')), 30_000);
    supervisor.once('exit', () => { clearTimeout(timeout); fail(new Error('fixture exited')); });
    supervisor.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('\n')) { clearTimeout(timeout); ok(JSON.parse(output.trim())); }
    });
  });
  assert.equal(await reaper(data.root, data.runId, true), 1, '活跃任务不能被 reaper 接管');
  supervisor.kill(signal); await done;
  if (signal === 'SIGKILL') {
    assert(existsSync(data.root));
    assert.equal(await reaper(data.root, 'e2e_' + '0'.repeat(24), true), 1);
    assert.equal(await reaper(data.root, data.runId, false), 0);
    assert(existsSync(data.root), 'dry-run 不能删目录');
    // 下一轮只回收当前 checkout 登记的失活任务，不要求用户手工清理。
    await withResources(async (r) => { await r.verify(); assert(!existsSync(data.root)); });
  }
  assert(!existsSync(data.root), '终止后资源目录必须清理');
}
async function main() {
  const roots: string[] = [];
  const identities = await Promise.all([1, 2].map(() => withResources(async (r) => {
    roots.push(r.root); await r.verify();
    const stoppable = r.spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0)); console.log('ready'); setInterval(()=>{},1000)"], r.env);
    await new Promise((ok) => stoppable.stdout!.once('data', ok));
    await stopChild(stoppable);
    assert.equal(stoppable.exitCode, 0, 'stopChild 返回前必须收齐 Node 退出码及 close 事件');
    assert.equal(statSync(r.root).mode & 0o777, 0o700);
    const registration = JSON.parse(readFileSync(join(r.root, 'resources.json'), 'utf8'));
    return { runId: r.runId, pgPort: registration.pgPort, redisPort: r.redisPort };
  })));
  assert.notEqual(identities[0].runId, identities[1].runId);
  assert.notEqual(identities[0].pgPort, identities[1].pgPort);
  assert.notEqual(identities[0].redisPort, identities[1].redisPort);
  assert(roots.every((root) => !existsSync(root)));
  let failedRoot = ''; let group = 0; let runId = '';
  await assert.rejects(withResources(async (r) => {
    failedRoot = r.root; runId = r.runId;
    const child = r.spawn(process.execPath, ['-e', "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'}).unref()"], r.env);
    group = child.pid!;
    await new Promise((ok) => child.once('exit', ok));
    throw new Error('injected failure');
  }), /injected failure/);
  assert(!existsSync(failedRoot));
  assert.deepEqual(ownedGroup(group, runId, failedRoot), [], '退出的消费者遗留后代也应被清理');
  await signalCase('SIGTERM'); await signalCase('SIGINT'); await signalCase('SIGKILL');
  console.log('隔离生命周期通过：两轮并发独立身份、异常清理、遗留后代、SIGTERM、SIGINT、SIGKILL 残留 dry-run/拒绝/定向恢复清理');
}
void main().catch((error) => { require('node:fs').writeFileSync('/tmp/backend-e2e-lifecycle-error.log', error instanceof Error ? error.stack : String(error), { mode: 0o600 }); console.error('隔离生命周期验证失败'); process.exitCode = 1; });
