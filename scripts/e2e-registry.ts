import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { processStart } from './e2e-processes';
import { reap } from './e2e-reap';

/** 登记范围绑定本 checkout，仅回收本 checkout 先前登记且 supervisor 已失活的运行。 */
export async function registry() {
  const scope = realpathSync(resolve(__dirname, '..'));
  const directory = join(tmpdir(), `wenyousite-e2e-registry-${process.getuid?.()}-${createHash('sha256').update(scope).digest('hex').slice(0, 16)}`);
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  assert(!stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700, '资源登记目录身份不匹配');
  for (const name of readdirSync(directory)) {
    assert(/^e2e_[a-f0-9]{24}\.json$/.test(name), '资源登记中存在未知文件');
    const file = join(directory, name);
    const entry = JSON.parse(readFileSync(file, 'utf8')) as { scope: string; runId: string; root: string; supervisorPid: number; supervisorStart: string };
    assert(Number.isSafeInteger(entry.supervisorPid) && entry.supervisorPid > 0 && /^\d+$/.test(entry.supervisorStart), 'supervisor 登记无效');
    assert(entry.scope === scope && name === `${entry.runId}.json`, '资源登记范围漂移');
    if (processStart(entry.supervisorPid) === entry.supervisorStart) continue;
    if (existsSync(entry.root)) {
      try { await reap(entry.root, entry.runId, true); } catch (error) { if (existsSync(entry.root)) throw error; }
    }
    try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return {
    add: (root: string, runId: string) => {
      const file = join(directory, `${runId}.json`);
      const entry = { scope, root, runId, supervisorPid: process.pid, supervisorStart: processStart(process.pid) };
      writeFileSync(file, JSON.stringify(entry), { flag: 'wx', mode: 0o600 });
      return () => { if (existsSync(file)) unlinkSync(file); };
    },
  };
}
