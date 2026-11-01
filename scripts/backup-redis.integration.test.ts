import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import { withResources, waitForChildClose } from './e2e-resources';

async function main() {
  await withResources(async (resources) => {
    await resources.verify();
    const client = new Redis({ host: '127.0.0.1', port: resources.redisPort, password: resources.redisPassword, retryStrategy: () => null });
    try {
      const identity = JSON.parse(readFileSync(join(resources.root, 'resources.json'), 'utf8')) as { redisPid: number; redisInstance: string };
      const bridge = join(resources.root, 'redis-client.cjs');
      writeFileSync(bridge, `
const Redis=require(${JSON.stringify(require.resolve('ioredis'))});
(async()=>{
 const r=new Redis({host:'127.0.0.1',port:Number(process.env.FIXTURE_REDIS_PORT),password:process.env.FIXTURE_REDIS_PASSWORD,retryStrategy:()=>null});
 try {
  if(!(await r.info('server')).includes('run_id:'+process.env.FIXTURE_REDIS_ID+'\\r\\n') || await r.get('e2e:ownership')!==process.env.E2E_RUN_ID) throw new Error('identity');
  try {console.log(await r.call(...process.argv.slice(2)));}
  catch(e) {if(e.message==='ERR Background save already in progress') console.log(e.message); else process.exitCode=1;}
 } finally {r.disconnect();}
})().catch(()=>{process.exitCode=1});
`, { mode: 0o600 });
      const env = { ...resources.env, FIXTURE_REDIS_PORT: String(resources.redisPort), FIXTURE_REDIS_PASSWORD: resources.redisPassword,
        FIXTURE_REDIS_ID: identity.redisInstance, FIXTURE_CLIENT: bridge, WENYOUSITE_REDIS_SAVE_WAIT_SECONDS: '15' };
      const run = () => {
        const child = resources.spawn('bash', ['-c', 'set -euo pipefail; source "$1/redis-snapshot.sh"; redis_cli() { shift; node "$FIXTURE_CLIENT" "$@"; }; wait_for_redis_snapshot fixture', 'fixture', __dirname], env);
        return { child, closed: waitForChildClose(child) };
      };
      assert.equal(await run().closed, 0, '本轮主动快照必须完成');
      for (let i = 0; i < 30; i++) await client.set(`${resources.runId}:backup:${i}`, 'fixture-data');
      await client.config('SET', 'rdb-key-save-delay', '30000');
      await client.bgsave();
      const before = (await client.info('persistence')).match(/^rdb_saves:(\d+)/m)?.[1];
      assert.ok((await client.info('persistence')).includes('rdb_bgsave_in_progress:1'));
      assert.equal(await run().closed, 0, '加入已有 BGSAVE 不等待不存在的第二次计数增加');
      const after = (await client.info('persistence')).match(/^rdb_saves:(\d+)/m)?.[1];
      assert.equal(after, before);
      await client.config('SET', 'rdb-key-save-delay', '300000');
      await client.bgsave();
      const ownedChildren = readFileSync(`/proc/${identity.redisPid}/task/${identity.redisPid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
      assert.equal(ownedChildren.length, 1);
      const failing = run();
      for (let i = 0; i < 100; i++) {
        if (readFileSync(resources.logPath(failing.child), 'utf8').includes('mode=joined')) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.match(readFileSync(resources.logPath(failing.child), 'utf8'), /mode=joined/);
      await resources.verify();
      assert.ok(readFileSync(`/proc/${identity.redisPid}/task/${identity.redisPid}/children`, 'utf8').split(/\s+/).includes(String(ownedChildren[0])));
      process.kill(ownedChildren[0], 'SIGKILL');
      assert.equal(await failing.closed, 1, '本轮独立 Redis 保存失败不得复用旧快照');
      await client.config('SET', 'rdb-key-save-delay', '0');
      await resources.verify();
      console.log(JSON.stringify({ event: 'backup-redis-integration-passed', runId: resources.runId, cases: 3 }));
    } finally {
      client.disconnect();
    }
  });
}

void main().catch(() => { console.error('backup-redis-integration: failed'); process.exitCode = 1; });
