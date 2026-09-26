import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inheritedHeavy, acquireHeavyLease } from './dev-heavy.mjs';
const script=fileURLToPath(new URL('./dev-heavy.mjs',import.meta.url));
function child(args){const p=spawn(process.execPath,[script,'--',...args],{stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);const done=new Promise(ok=>p.once('close',code=>ok({code,output})));return {p,done,get output(){return output;}};}
test('跨任务重命令竞争被拒绝，父子嵌套可重入，结束释放锁',async()=>{
 if(inheritedHeavy()){const nested=await child([process.execPath,script,'--',process.execPath,'-e','process.exit(0)']).done;assert.equal(nested.code,0,nested.output);return;}
 const held=child([process.execPath,'-e',"console.log('ready');setTimeout(()=>{},1500)"]);
 for(let i=0;i<50&&!held.output.includes('ready');i++)await new Promise(ok=>setTimeout(ok,20));
 assert(held.output.includes('ready'));
 const rejected=await child([process.execPath,'-e','process.exit(0)']).done;assert.equal(rejected.code,75);
 assert.equal((await held.done).code,0);
 const nested=await child([process.execPath,script,'--',process.execPath,'-e','process.exit(0)']).done;
 assert.equal(nested.code,0,nested.output);
});

test('资源租约释放后不能凭本进程残留登记绕过锁',async()=>{
 const inherited=inheritedHeavy();const release=await acquireHeavyLease();assert(inheritedHeavy());await release();assert.equal(inheritedHeavy(),inherited);
});
