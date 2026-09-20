/** SIGKILL/主机故障后残留处置：默认只读，禁止清理仍有原 supervisor 的任务。 */
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { processStart, ownedGroup, stopOwnedGroup } from './e2e-processes';
export async function reap(rootInput: string, runId: string, apply = false) {
  const root = realpathSync(rootInput);
  const stat = lstatSync(rootInput);
  assert(/^wenyousite-e2e-[a-zA-Z0-9]+$/.test(basename(root)) && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, '非法隔离目录');
  const own = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
  assert(own.root === root && own.uid === process.getuid?.() && own.runId === runId, '资源身份不匹配');
  const registry = JSON.parse(readFileSync(join(root, 'processes.json'), 'utf8')) as {
    runId: string; root: string; supervisorPid: number; supervisorStart: string; processes: Array<{ group: number; started: string }>;
  };
  assert(Number.isSafeInteger(registry.supervisorPid) && registry.supervisorPid > 0 && /^\d+$/.test(registry.supervisorStart), 'supervisor 登记无效');
  assert(registry.root === root && registry.runId === own.runId, '进程登记身份不匹配');
  assert(processStart(registry.supervisorPid) !== registry.supervisorStart, '原 runner 仍在运行，拒绝清理');
  for (const p of registry.processes) {
    assert(Number.isSafeInteger(p.group) && p.group > 0 && /^\d+$/.test(p.started), '进程登记无效');
    const current = processStart(p.group);
    assert(!current || current === p.started, 'PID 已复用，拒绝自动清理');
    ownedGroup(p.group, own.runId, root, p.started);
  }
  const result = { mode: apply ? 'apply' : 'dry-run', runId: own.runId, groups: registry.processes.map((p) => p.group) };
  if (!apply) return result;
  for (const p of registry.processes.reverse()) await stopOwnedGroup(p.group, own.runId, root, p.started);
  assert(realpathSync(root) === own.root, '清理前目录身份漂移');
  rmSync(root, { recursive: true });
  return result;
}
async function main() {
  const { values } = parseArgs({ options: { root: { type: 'string' }, 'run-id': { type: 'string' }, apply: { type: 'boolean', default: false } } });
  assert(values.root && values['run-id'], '需要 --root 与原 --run-id');
  console.log(JSON.stringify(await reap(values.root, values['run-id'], values.apply)));
}
if (require.main === module) void main().catch(() => { console.error('残留清理拒绝：请核对原任务身份、进程及私有登记；未扩大清理范围'); process.exitCode = 1; });
