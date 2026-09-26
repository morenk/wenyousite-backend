import assert from 'node:assert/strict';
import { join } from 'node:path';
import { consumer, load, verifyConsumer } from './common';
import { cleanup, reset, start, withLock } from './lifecycle';
import { stop } from './resources';
import { adminSnapshot } from './snapshot';

export function parseArgs(input:string[]) {
  const args:Record<string,string>={};
  assert(input.length%2===0,'参数必须为 --key value');
  for(let i=0;i<input.length;i+=2){
    assert(/^--[a-z-]+$/.test(input[i])&&!Object.hasOwn(args,input[i].slice(2)),'参数非法或重复');
    args[input[i].slice(2)]=input[i+1];
  }
  return args;
}
export async function main(input=process.argv.slice(2)) {
  const [command,...rest]=input;const args=parseArgs(rest);
  if(command==='snapshot'){await adminSnapshot(args);return;}
  assert(['start','resume','status','export','stop','reset','cleanup'].includes(command),'未知预览命令');
  assert(args.session,'必须指定 --session');
  assert(Object.keys(args).every(k=>['session','snapshot','web-port','confirm'].includes(k)),'未知预览参数');
  await withLock(args.session,async()=>{
    if(command==='start'||command==='resume'||command==='reset'){
      const s=command==='reset'?await reset(args.session,args):await start(args.session,args);
      console.log(JSON.stringify({state:s.state,sessionId:s.sessionId,runId:s.runId,consumerPath:join(s.root,'consumer.json')}));
      return;
    }
    const s=load(args.session);
    if(command==='export'){assert.equal(s.state,'ready');await verifyConsumer(s);console.log(JSON.stringify(consumer(s)));return;}
    if(command==='status'){
      let verified=false;
      if(s.state==='ready')try{await verifyConsumer(s);verified=true;}catch{/* 状态明确报告失活，不宣称可用。 */}
      console.log(JSON.stringify({state:s.state==='ready'&&!verified?'unavailable':s.state,sessionId:s.sessionId,runId:s.runId,verified,sourceSha:s.backendSha,sourceDigest:s.sourceDigest,sourceDirty:s.sourceDirty,consumerPath:join(s.root,'consumer.json')}));return;
    }
    if(command==='stop')await stop(s);
    if(command==='cleanup')await cleanup(s,args.confirm);
    console.log(JSON.stringify({state:command==='cleanup'?'cleaned':'stopped',sessionId:s.sessionId,runId:s.runId}));
  });
}
if(require.main===module)void main().catch(()=>{console.error(JSON.stringify({error:'PREVIEW_COMMAND_FAILED',detail:'检查参数、资源归属与本批次私有日志；禁止回落线上'}));process.exitCode=1;});
