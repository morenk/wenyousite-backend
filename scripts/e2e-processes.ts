import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import assert from 'node:assert/strict';

export function processStart(pid: number) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ')[19]; } catch { return undefined; }
}
/** 按进程组与随机身份双重核对，防止 PID 复用或父进程先退出时误杀/漏掉后代。 */
export function ownedGroup(group: number, runId: string, root: string, started?: string) {
  const members: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let fields: string[];
    try { fields = readFileSync(`/proc/${entry}/stat`, 'utf8').split(') ').at(-1)!.split(' '); } catch { continue; }
    if (Number(fields[2]) !== group || ['Z', 'X'].includes(fields[0])) continue;
    try {
      const env = readFileSync(`/proc/${entry}/environ`, 'utf8').split('\0');
      const environmentMatches = env.includes(`E2E_RUN_ID=${runId}`) && env.includes(`E2E_RESOURCE_ROOT=${root}`);
      // Redis setproctitle 会覆盖 /proc/environ；仅原 leader 可凭已登记启动时间与私有 cwd 核验。
      const leaderMatches = Number(entry) === group && !!started && processStart(group) === started
        && realpathSync(`/proc/${entry}/cwd`) === root;
      assert(statSync(`/proc/${entry}`).uid === process.getuid?.() && (environmentMatches || leaderMatches), '进程组身份漂移，拒绝终止');
      members.push(Number(entry));
    } catch (error) {
      // stat 与 environ/cwd 并非原子快照：退出可能清空身份或撤销访问权限。
      // PF_EXITING (Linux sched.h: 0x4) 会先于 Z/X 置位，此时 environ 已可能返回 EACCES。
      // 仅同启动时间且已进入不可逆退出的原进程可忽略；活进程与 PID 复用仍拒绝。
      try {
        const current = readFileSync(`/proc/${entry}/stat`, 'utf8').split(') ').at(-1)!.split(' ');
        if (current[19] === fields[19] && (['Z', 'X'].includes(current[0]) || (Number(current[6]) & 0x4) !== 0)) continue;
      } catch (stateError) {
        if (['ENOENT', 'ESRCH'].includes((stateError as NodeJS.ErrnoException).code ?? '')) continue;
      }
      throw error;
    }
  }
  return members;
}
export async function stopOwnedGroup(group: number, runId: string, root: string, started?: string) {
  if (!ownedGroup(group, runId, root, started).length) return;
  try { process.kill(-group, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!ownedGroup(group, runId, root, started).length) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  if (ownedGroup(group, runId, root, started).length) {
    try { process.kill(-group, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!ownedGroup(group, runId, root, started).length) return;
      await new Promise((ok) => setTimeout(ok, 100));
    }
  }
  assert.equal(ownedGroup(group, runId, root, started).length, 0, '隔离进程仍在运行，保留目录');
}
