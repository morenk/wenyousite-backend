import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request, type IncomingHttpHeaders } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { startDownloadGateway } from '../../src/app-downloads/download-main';
import { DownloadPublisher } from '../../src/app-downloads/download-publisher';
import { beijingPeriods } from '../../src/app-downloads/download-budget';
import { isolatedFiles, apkFixture } from './fixture';

function http(socketPath:string,path:string,method='GET',headers:IncomingHttpHeaders={}) {
  return new Promise<{status:number;headers:IncomingHttpHeaders;body:Buffer}>((resolve,reject)=>{
    const req=request({socketPath,path,method,headers:{'x-real-ip':'192.0.2.1',...headers}},res=>{
      const body:Buffer[]=[];res.on('data',v=>body.push(v));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(body)}));
    });req.on('error',reject);req.end();
  });
}
function totals(directory:string) {
  const db=new DatabaseSync(join(directory,'budget.sqlite'),{readOnly:true});
  try {return {counts:db.prepare('SELECT kind,sum(downloads) AS n FROM download_counts GROUP BY kind ORDER BY kind').all(),bytes:Number(db.prepare('SELECT bytes FROM counters WHERE period=?').get(beijingPeriods(Date.now()).day)?.bytes??0)};}finally{db.close();}
}
async function warm(p:DownloadPublisher,build:number,bytes=16384) {
  const fixture=apkFixture(build,bytes);await p.register(fixture.artifact);
  await p.warm(build,{async head(){},async get(){return Readable.from([fixture.buffer]);},close(){}});
  await p.publish(build,'2026-10-03T00:00:00.000Z');return fixture;
}
const path=(build=42)=>`/api/v1/app-downloads/android/${build}/file`;
const infoPath='/api/v1/app-downloads/android';
function retryDay(headers:IncomingHttpHeaders) {assert(Math.abs(Number(headers['retry-after'])-beijingPeriods(Date.now()).dayRetry)<=1);}

test('UDS：同 IP 多浏览器、同浏览器跨 IP/构建，HEAD 预检与全局 info 分离',async()=>{
  const {root,config}=await isolatedFiles(),p=new DownloadPublisher(config);let server:Awaited<ReturnType<typeof startDownloadGateway>>|undefined;
  try {
    await warm(p,42);await warm(p,43);server=await startDownloadGateway(config);
    const cookies:string[]=[];
    for(let i=0;i<4;i++){const info=await http(config.DOWNLOAD_SOCKET,infoPath);assert.equal(info.status,200);const set=info.headers['set-cookie']?.[0];assert(set?.includes('; HttpOnly; SameSite=Lax;')&&set.endsWith('; Secure'));cookies.push(set!.split(';')[0]);}
    const beforeHead=totals(config.DOWNLOAD_EGRESS_DIR);
    for(let i=0;i<2;i++)assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'HEAD',{cookie:cookies[0]})).status,200);
    assert.deepEqual(totals(config.DOWNLOAD_EGRESS_DIR),beforeHead);
    for(let i=0;i<3;i++)assert.equal((await http(config.DOWNLOAD_SOCKET,path(i%2?43:42),'GET',{cookie:cookies[0]})).status,200);
    const denied=await http(config.DOWNLOAD_SOCKET,path(),'HEAD',{cookie:cookies[0],'x-real-ip':'192.0.2.2'});
    assert.equal(denied.status,429);assert.equal(denied.headers['x-download-limit-reason'],'device_daily_limit');assert.equal(denied.body.length,0);retryDay(denied.headers);
    const global=await http(config.DOWNLOAD_SOCKET,infoPath,'GET',{cookie:cookies[0]});assert.equal(global.status,200);assert.equal(JSON.parse(global.body.toString()).data.status,'available');
    for(const cookie of cookies.slice(1,3))for(let i=0;i<3;i++)assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'GET',{cookie})).status,200);
    assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'GET',{cookie:cookies[3]})).status,200);
    const before=totals(config.DOWNLOAD_EGRESS_DIR), limited=await http(config.DOWNLOAD_SOCKET,path(),'GET',{cookie:cookies[3]});
    assert.equal(limited.status,429);assert.equal(limited.headers['x-download-limit-reason'],'ip_daily_limit');retryDay(limited.headers);
    const after=totals(config.DOWNLOAD_EGRESS_DIR);assert.deepEqual(after.counts,before.counts);
    assert.equal(after.bytes-before.bytes,limited.body.length); // 错误 JSON 收费，APK 正文与次数不扣。
    if(limited.body.length)assert.deepEqual(JSON.parse(limited.body.toString()),{code:42900,message:'下载请求暂受限制',data:null});
    assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'HEAD',{cookie:cookies[3]})).headers['x-download-limit-reason'],'ip_daily_limit');
  } finally {await server?.close();await rm(root,{recursive:true,force:true});}
});

test('旧 APP 无 Cookie 直接 HEAD/GET：失败不计次、Range 每 GET 计次、伪造转发头不换 IP 配额',async()=>{
  const {root,config}=await isolatedFiles(),p=new DownloadPublisher(config);let server:Awaited<ReturnType<typeof startDownloadGateway>>|undefined;
  try {
    const f=await warm(p,42);server=await startDownloadGateway(config);
    assert.equal((await http(config.DOWNLOAD_SOCKET,path(999))).status,404);
    assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'GET',{range:'bytes=0-1,3-4'})).status,416);
    assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'GET',{'x-real-ip':'192.0.2.1,198.51.100.2'})).status,503);
    assert.equal(totals(config.DOWNLOAD_EGRESS_DIR).counts.length,0);
    for(let i=0;i<10;i++) {
      const head=await http(config.DOWNLOAD_SOCKET,path(),'HEAD');assert.equal(head.status,200);assert.equal(head.headers['x-amz-meta-apk-sha256'],f.artifact.sha256);
      const response=await http(config.DOWNLOAD_SOCKET,path(),'GET',{...(i?{range:'bytes=0-0'}:{}),...(i%2?{cookie:'__Host-wenyou-download-device=forged'}:{}),'x-forwarded-for':`198.51.100.${i+1}`,forwarded:`for=198.51.100.${i+1}`});
      assert.equal(response.status,i?206:200);assert.equal(response.body.length,i?1:f.buffer.length);
    }
    const head=await http(config.DOWNLOAD_SOCKET,path(),'HEAD');assert.equal(head.status,429);assert.equal(head.headers['x-download-limit-reason'],'ip_daily_limit');
    const response=await http(config.DOWNLOAD_SOCKET,path());assert.equal(response.status,429);assert.equal(response.headers['x-download-limit-reason'],'ip_daily_limit');
    assert(totals(config.DOWNLOAD_EGRESS_DIR).counts.every(row=>row.n===10));
  } finally {await server?.close();await rm(root,{recursive:true,force:true});}
});

test('跨 IP 并发 GET 只有一次获准；HEAD→GET 竞争、断连与重启均不退次数或正文预算',async()=>{
  const {root,config}=await isolatedFiles();config.DOWNLOAD_DEVICE_DAY_COUNT=1;
  const p=new DownloadPublisher(config);let server:Awaited<ReturnType<typeof startDownloadGateway>>|undefined;
  try {
    const f=await warm(p,42,2*1024**2);server=await startDownloadGateway(config);
    const info=await http(config.DOWNLOAD_SOCKET,infoPath),cookie=info.headers['set-cookie']![0].split(';')[0];
    for(const ip of ['192.0.2.1','192.0.2.2'])assert.equal((await http(config.DOWNLOAD_SOCKET,path(),'HEAD',{cookie,'x-real-ip':ip})).status,200);
    const before=totals(config.DOWNLOAD_EGRESS_DIR), results=await Promise.all(['192.0.2.1','192.0.2.2'].map(ip=>new Promise<{status:number;bodyBytes:number}>((resolve,reject)=>{
      const req=request({socketPath:config.DOWNLOAD_SOCKET,path:path(),headers:{cookie,'x-real-ip':ip}},res=>{
        if(res.statusCode===200){res.on('error',()=>{});req.destroy();resolve({status:200,bodyBytes:0});return;}
        let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode!,bodyBytes:bytes}));
      });req.on('error',error=>{if(!req.destroyed)reject(error);});req.end();
    })));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);
    for(let i=0;i<100&&server.gateway.admission.count();i++)await new Promise(ok=>setTimeout(ok,10));
    assert.equal(server.gateway.admission.count(),0);
    const after=totals(config.DOWNLOAD_EGRESS_DIR);assert(after.counts.every(row=>row.n===1));
    assert.equal(after.bytes-before.bytes,f.buffer.length+results.reduce((n,r)=>n+r.bodyBytes,0));
    await server.close();server=await startDownloadGateway(config);
    const denied=await http(config.DOWNLOAD_SOCKET,path(),'HEAD',{cookie,'x-real-ip':'203.0.113.7'});assert.equal(denied.status,429);assert.equal(denied.headers['x-download-limit-reason'],'device_daily_limit');
    assert.deepEqual(totals(config.DOWNLOAD_EGRESS_DIR),after);
  } finally {await server?.close();await rm(root,{recursive:true,force:true});}
});
