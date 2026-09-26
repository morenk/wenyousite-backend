import assert from 'node:assert/strict';
import { join } from 'node:path';
import { consumer, load, loadAt, REPO, save, stateRoot, verifyConsumer, writePrivate } from './common';
import { assertRebindSafe, cleanup, rebind, reset, start, withLock } from './lifecycle';
import { stop } from './resources';
import { listSessions, processesAlive, registerRoot, withControlLock } from './control';
import { adminSnapshot } from './snapshot';

export function parseArgs(input:string[]) {
  const args:Record<string,string>={};assert(input.length%2===0,'参数必须为 --key value');
  for(let i=0;i<input.length;i+=2){assert(/^--[a-z-]+$/.test(input[i])&&!Object.hasOwn(args,input[i].slice(2)),'参数非法或重复');args[input[i].slice(2)]=input[i+1];}
  return args;
}
export async function main(input=process.argv.slice(2)) {
  const [command,...rest]=input;const args=parseArgs(rest);
  if(command==='snapshot'){await adminSnapshot(args);return;}
  if(command==='list'){assert(!rest.length);console.log(JSON.stringify(await withControlLock(async()=>{registerRoot();return listSessions();})));return;}
  assert(['start','resume','status','export','pause','stop','rebind','adopt','reset','cleanup'].includes(command),'未知预览命令');
  assert(args.session,'必须指定 --session');
  assert(Object.keys(args).every(k=>['session','snapshot','web-port','confirm','owner-worktree'].includes(k)),'未知预览参数');
  await withLock(args.session,async()=>{
    registerRoot();
    if(command==='start'||command==='resume'||command==='reset'||command==='rebind'){
      assert(!args['owner-worktree'],'恢复必须由当前 owner 执行；旧批次先显式 adopt');
      const s=command==='reset'?await reset(args.session,args):command==='rebind'?await rebind(args.session,args.confirm):await start(args.session,args);
      console.log(JSON.stringify({state:s.state,sessionId:s.sessionId,runId:s.runId,consumerPath:join(s.root,'consumer.json')}));return;
    }
    const foreign=!!args['owner-worktree'];
    assert(!foreign||['stop','pause','adopt'].includes(command),'owner-worktree 只用于显式停止或迁移');
    const s=foreign?loadAt(stateRoot(),args.session):load(args.session);
    if(foreign){assert.equal(s.worktree,args['owner-worktree'],'owner 已变化');assert.equal(args.confirm,s.runId,'必须确认精确 runId');}
    if(command==='export'){assert.equal(s.state,'ready');await verifyConsumer(s);console.log(JSON.stringify(consumer(s)));return;}
    if(command==='status'){
      const item=(await listSessions()).sessions.find(x=>x.sessionId===s.sessionId&&x.stateRoot===stateRoot());
      console.log(JSON.stringify({...item,sourceSha:s.backendSha,sourceDigest:s.sourceDigest,sourceDirty:s.sourceDirty}));return;
    }
    if(command==='stop'||command==='pause'){if(args.confirm)assert.equal(args.confirm,s.runId,'runId 已变化');await stop(s);}
    if(command==='adopt'){
      assert(foreign,'adopt 必须提供已登记 owner-worktree');assert(!processesAlive(s)&&['stopped','failed'].includes(s.state),'先暂停并确认进程停止');
      assertRebindSafe(s);s.worktree=REPO;save(s);writePrivate(join(s.root,'ownership.json'),{runId:s.runId,root:s.root,uid:s.uid,worktree:REPO});
    }
    if(command==='cleanup')await cleanup(s,args.confirm);
    console.log(JSON.stringify({state:command==='cleanup'?'cleaned':command==='adopt'?'adopted':'paused',sessionId:s.sessionId,runId:s.runId,worktree:s.worktree,processesAlive:processesAlive(s)}));
  });
}
if(require.main===module)void main().catch((error)=>{
  const code=String(error?.message||'').match(/^(PREVIEW_[A-Z_]+)(?::|$)/)?.[1]||'PREVIEW_COMMAND_FAILED';
  console.error(JSON.stringify({error:code,detail:'操作未完成；核对批次身份、资源归属或媒体迁移要求，禁止回落线上'}));process.exitCode=1;
});
