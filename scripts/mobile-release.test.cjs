const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const script = path.join(__dirname, 'promote-android-release.sh');
const version = '1.0.0'; const build = 42; const sha = 'a'.repeat(64);
const url = 'https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-1.0.0-42.apk';
const args = ['--version',version,'--build',String(build),'--url',url,'--size','123','--sha256',sha,'--notes-revision','1'];
function fixture(t) {
  assert.notEqual(process.getuid(), 0, '测试不能以 root 执行固定生产入口');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-release-shell-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const envFile = path.join(root,'backend.env'); const history = path.join(root,'history.tsv');
  const original = 'DATABASE_URL=postgresql://unused.invalid/test\nMOBILE_ANDROID_RECOMMENDED_BUILD=\nMOBILE_ANDROID_UPDATE_URL=\nMOBILE_ANDROID_MIN_SUPPORTED_BUILD=\nMOBILE_IOS_RECOMMENDED_BUILD=20\n';
  fs.writeFileSync(envFile,original,{mode:0o600});
  const helper=path.join(root,'helper.cjs');
  fs.writeFileSync(helper, `
const fs=require('node:fs'), path=require('node:path');
const [action,envFile]=process.argv.slice(2), root=path.dirname(envFile);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const stateFile=path.join(root,'state.json'), flagsFile=path.join(root,'flags.json');
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
const flags=fs.existsSync(flagsFile)?JSON.parse(fs.readFileSync(flagsFile)):{};
if(flags.fail===action){process.stderr.write('injected failure');process.exit(1);}
if(action==='preflight') {
 if(Object.values(state).some(x=>!['SUCCEEDED','ABORTED'].includes(x.status))) process.exit(1);
 console.log(JSON.stringify({schemaVersion:1,platform:'android',versionName:'1.0.0',buildNumber:42,confirmedRevision:1}));
} else if(action==='status') console.log(JSON.stringify({status:state[input.operationId]?.status??'ABSENT'}));
else {
 const status={begin:'PREPARED',publish:'STAGED',commit:'COMMITTED',finish:'SUCCEEDED',abort:'ABORTED'}[action];
 if(action==='begin' && input.confirmedRevision!==1) process.exit(1);
 if(!status) process.exit(1);
 state[input.operationId]={status}; fs.writeFileSync(stateFile,JSON.stringify(state));
 if(flags.crash===action){fs.writeFileSync(path.join(root,'paused'),'1');setInterval(()=>{},1000);}
 else console.log(JSON.stringify({status}));
}
`);
  const curl = path.join(root,'curl');
  fs.writeFileSync(curl, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const root=__dirname;
const flags=fs.existsSync(path.join(root,'flags.json'))?JSON.parse(fs.readFileSync(path.join(root,'flags.json'))):{};
const args=process.argv.slice(2),url=args.at(-1);
if(args.includes('--head')) console.log('content-type: application/vnd.android.package-archive\\ncontent-length: 123\\ncache-control: public, max-age=31536000, immutable\\ncontent-disposition: attachment; filename="wenyou-1.0.0-42.apk"\\nx-amz-meta-apk-sha256: ${sha}\\nx-amz-meta-application-id: site.wenyou.app\\nx-amz-meta-version-name: 1.0.0\\nx-amz-meta-version-code: 42');
else if(url.endsWith('.sha256')) console.log('${sha}  wenyou-1.0.0-42.apk');
else if(url.endsWith('/meta')) {
 const e=Object.fromEntries(fs.readFileSync(path.join(root,'backend.env'),'utf8').trim().split('\\n').map(x=>x.split('=')));
 const b=Number(e.MOBILE_ANDROID_RECOMMENDED_BUILD)||null;
 console.log(JSON.stringify({data:{mobileCompatibility:{android:{recommendedBuild:flags.fail==='meta' && b===42?999:b,minimumSupportedBuild:Number(e.MOBILE_ANDROID_MIN_SUPPORTED_BUILD)||null,updateUrl:e.MOBILE_ANDROID_UPDATE_URL||null}}}}));
} else if(url.includes('/mobile-releases/')) {
 if(flags.fail==='public') process.exit(1);
 console.log(JSON.stringify({data:{platform:'android',versionName:'1.0.0',buildNumber:42,revision:1}}));
} else if(url.endsWith('/health')) console.log('{}'); else process.exit(1);
`,{mode:0o700});
  const systemctl=path.join(root,'systemctl');
  fs.writeFileSync(systemctl,`#!${process.execPath}\nrequire('node:fs').appendFileSync(__dirname+'/systemctl.log',process.argv.slice(2).join(' ')+'\\n');\n`,{mode:0o700});
  const env={...process.env,PATH:root+':'+process.env.PATH,BACKEND_ENV_FILE:envFile,MOBILE_RELEASE_HISTORY_FILE:history,MOBILE_RELEASE_CURL_BIN:curl,MOBILE_RELEASE_NODE_BINARY:process.execPath,MOBILE_RELEASE_NOTES_HELPER:helper,MOBILE_RELEASE_SKIP_RESTART:'false'};
  const run=(options=args)=>spawnSync('bash',[script,...options],{env,encoding:'utf8',timeout:20000});
  const flags=value=>fs.writeFileSync(path.join(root,'flags.json'),JSON.stringify(value));
  return {root,env,envFile,history,original,run,flags,state:()=>JSON.parse(fs.readFileSync(path.join(root,'state.json'),'utf8')),journal:path.join(root,'.mobile-release.pending')};
}
test('预检只读且机器输出固定；晋级绑定 revision，同 build 幂等，撤回保留历史',t=>{
 const f=fixture(t);const pre=f.run(['--preflight','--version',version,'--build','42']);assert.equal(pre.status,0,pre.stderr);assert.equal(JSON.parse(pre.stdout).confirmedRevision,1);assert.equal(fs.existsSync(f.history),false);assert.equal(fs.existsSync(f.journal),false);
 for(let i=0;i<2;i++){const r=f.run();assert.equal(r.status,0,r.stderr);}
 assert.equal(fs.readFileSync(f.history,'utf8').trim().split('\n').length,1);
 assert.match(fs.readFileSync(f.envFile,'utf8'),/MOBILE_IOS_RECOMMENDED_BUILD=20/);
 assert.equal(f.run(['--withdraw']).status,0);
 assert.equal(fs.readFileSync(f.history,'utf8').trim().split('\n').length,2);
 assert.equal(f.run(['--recover','--build','42']).status,2);
 assert.notEqual(f.run(args.slice(0,-2)).status,0);
});
for(const stage of ['begin','publish','commit','finish','meta','public']) test(`失败 ${stage} 恢复原策略/历史并可重试`,t=>{
 const f=fixture(t);f.flags({fail:stage});const r=f.run();assert.notEqual(r.status,0);
 assert.equal(fs.readFileSync(f.envFile,'utf8'),f.original);assert.equal(fs.existsSync(f.history),false);assert.equal(fs.existsSync(f.journal),false,r.stderr);
 if(stage==='begin')assert.equal(fs.existsSync(path.join(f.root,'systemctl.log')),false,'说明领取失败不得重启服务');
 f.flags({});const retry=f.run();assert.equal(retry.status,0,retry.stderr);assert.equal(fs.readFileSync(f.history,'utf8').trim().split('\n').length,1);
});
test('TSV 原子替换失败补偿且重试不遗漏说明登记',t=>{
 const f=fixture(t);const mv=path.join(f.root,'mv');
 fs.writeFileSync(mv,`#!/bin/sh\ncase "$1 $2 $3" in *next.tsv*) exit 1;; esac\nexec /usr/bin/mv "$@"\n`,{mode:0o700});
 assert.notEqual(f.run().status,0);assert.equal(fs.readFileSync(f.envFile,'utf8'),f.original);assert.equal(fs.existsSync(f.journal),false);
 fs.unlinkSync(mv);assert.equal(f.run().status,0);
});
for(const stage of ['begin','publish','commit']) test(`SIGKILL ${stage} 后预检只读拒绝，--recover 恢复并允许重试`,async t=>{
 const f=fixture(t);f.flags({crash:stage});
 const child=spawn('bash',[script,...args],{env:f.env,detached:true,stdio:'ignore'});
 const done=new Promise(ok=>child.once('exit',ok));
 t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
 for(let i=0;i<500 && !fs.existsSync(path.join(f.root,'paused'));i++) await new Promise(ok=>setTimeout(ok,10));
 assert(fs.existsSync(path.join(f.root,'paused')),'未到达故障注入点');process.kill(-child.pid,'SIGKILL');await done;
 assert(fs.existsSync(f.journal));assert.notEqual(f.run(['--preflight','--version',version,'--build','42']).status,0);
 f.flags({});const recovered=f.run(['--recover']);assert.equal(recovered.status,0,recovered.stderr);assert.equal(JSON.parse(recovered.stdout).recovered,true);
 assert.equal(fs.readFileSync(f.envFile,'utf8'),f.original);assert.equal(fs.existsSync(f.history),false);assert.equal(fs.existsSync(f.journal),false);
 assert.equal(f.run().status,0);
});
test('保留 URL/摘要/构建号降级校验，历史同 build 必须匹配 APK',t=>{
 const f=fixture(t);
 const hashArgs=[...args];hashArgs[hashArgs.indexOf('--sha256')+1]='b'.repeat(64);
 assert.notEqual(f.run(hashArgs).status,0);
 const urlArgs=[...args];urlArgs[urlArgs.indexOf('--url')+1]='https://example.invalid/app.apk';
 assert.notEqual(f.run(urlArgs).status,0);
 fs.writeFileSync(f.envFile,f.original.replace('MOBILE_ANDROID_RECOMMENDED_BUILD=','MOBILE_ANDROID_RECOMMENDED_BUILD=43'));
 assert.notEqual(f.run().status,0);
 fs.writeFileSync(f.envFile,f.original);
 fs.writeFileSync(f.history,'2026-09-27\tpromote\tandroid\t1.0.0\t42\t'+'b'.repeat(64)+'\t123\t'+url+'\n');
 assert.notEqual(f.run().status,0);
 assert.equal(fs.readFileSync(f.envFile,'utf8'),f.original);
});
test('DB 状态暂时不可读仍补偿策略，保留 journal 等待受限恢复',async t=>{
 const f=fixture(t);f.flags({crash:'commit'});
 const child=spawn('bash',[script,...args],{env:f.env,detached:true,stdio:'ignore'});
 const done=new Promise(ok=>child.once('exit',ok));t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
 for(let i=0;i<500&&!fs.existsSync(path.join(f.root,'paused'));i++)await new Promise(ok=>setTimeout(ok,10));
 assert(fs.existsSync(path.join(f.root,'paused')));process.kill(-child.pid,'SIGKILL');await done;
 f.flags({fail:'status'});assert.notEqual(f.run(['--recover']).status,0);
 assert.equal(fs.readFileSync(f.envFile,'utf8'),f.original);assert(fs.existsSync(f.journal));
 f.flags({});assert.equal(f.run(['--recover']).status,0);assert.equal(fs.existsSync(f.journal),false);
});
