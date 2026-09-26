import assert from 'node:assert/strict';
import { createServer, IncomingMessage, request, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { consumer, hash, HEADER, identity, load, Session, writePrivate } from './common';
import { alive, clients, ownsListener, verifyResources } from './resources';
import { historicalDownload } from './history';
import { validateHistoricalMap } from './snapshot';
import { verifyS3Signature } from './signature';

// s3rver 没有官方 TS 类型；开发专用适配接口限定为实际调用面。
const S3rver = require('s3rver') as new (options:Record<string,unknown>)=>{configureBuckets():Promise<void>;callback():(req:IncomingMessage,res:ServerResponse)=>void};
export async function gateway(name:string) {
  const s=load(name);const c=consumer(s);
  const {db,redis}=clients(s);
  const cors='<CORSConfiguration><CORSRule><AllowedOrigin>'+c.web.origin+'</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>POST</AllowedMethod><AllowedMethod>DELETE</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>';
  const storage=new S3rver({directory:join(s.root,'uploads'),silent:true,resetOnClose:false,allowMismatchedSignatures:false,vhostBuckets:false,configureBuckets:[{name:'preview',configs:[cors]}]});
  await storage.configureBuckets();
  const s3=storage.callback();
  const local=new S3Client({endpoint:c.media.origin,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'S3RVER',secretAccessKey:s.mediaSecret!}});
  const mediaText=readFileSync(join(s.root,'historical-media.json'),'utf8');
  assert.equal(hash(mediaText),s.snapshot.mediaSha256,'历史媒体映射校验失败');
  const map=JSON.parse(mediaText) as Record<string,string>;
  validateHistoricalMap(map,s.snapshot.mediaOrigin);
  const tombstoneFile=join(s.root,'media-tombstones.json');
  const tombstones=new Set<string>(existsSync(tombstoneFile)?JSON.parse(readFileSync(tombstoneFile,'utf8')):[]);
  const inFlight=new Map<string,Promise<void>>();
  const prepareHistory=async(key:string)=>{
    if(!Object.hasOwn(map,key)||tombstones.has(key))return;
    let job=inFlight.get(key);
    if(!job) {
      job=(async()=>{
        // 内部请求禁止再次触发历史回源；这个头不放行任何远端写入。
        try {await local.send(new HeadObjectCommand({Bucket:'preview',Key:key}),{});return;} catch(error) {
          if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw error;
        }
        const result=await historicalDownload(key,map,s.snapshot.mediaOrigin);
        if(tombstones.has(key))return;
        await local.send(new PutObjectCommand({Bucket:'preview',Key:key,Body:result.body,ContentType:result.contentType}));
      })().finally(()=>inFlight.delete(key));
      inFlight.set(key,job);
    }
    await job;
  };
  // SDK 的内部 HEAD 只用于本地存在性探测，不能递归回源。
  local.middlewareStack.add((next)=>async args=>{
    const req=args.request as {headers:Record<string,string>};
    req.headers['x-preview-local-only']=s.runId;
    return next(args);
  },{step:'build',name:'previewLocalOnly'});
  const send=(res:ServerResponse,status:number,body:unknown)=>{
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',[HEADER]:s.runId});res.end(JSON.stringify(body));
  };
  const guard=async(req:IncomingMessage,res:ServerResponse,role:'backend'|'media')=>{
    const fresh=load(s.sessionId);
    assert(fresh.runId===s.runId,'会话已替换');
    await verifyResources(s,db,redis);
    if(role==='media')assert(alive(fresh,'worker'),'图片 Worker 未运行');
    if(role==='backend')assert(alive(fresh,'api')&&ownsListener(fresh,'api',s.ports.api),'API 进程或监听归属不符');
    if(req.url==='/__preview/identity'&&req.method==='GET'){send(res,200,identity(s,role));return false;}
    if(role==='backend'&&req.headers[HEADER.toLowerCase()]!==s.runId){send(res,409,{error:'PREVIEW_IDENTITY_REQUIRED'});return false;}
    if(req.headers.origin&&req.headers.origin!==c.web.origin){send(res,403,{error:'PREVIEW_ORIGIN_REJECTED'});return false;}
    res.setHeader(HEADER,s.runId);return true;
  };
  const backend=createServer((req,res)=>{
    void (async()=>{
      if(!await guard(req,res,'backend'))return;
      assert(req.url?.startsWith('/api/v1/'),'只代理业务 API 路由');
      const forwarded=request({host:'127.0.0.1',port:s.ports.api,path:req.url,method:req.method,headers:{...req.headers,cookie:(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>!x.startsWith('refreshToken=')&&(!x.startsWith('preview-')||x.startsWith('preview-'+s.runId+'-refreshToken='))).map(x=>x.startsWith('preview-'+s.runId+'-')?x.slice(('preview-'+s.runId+'-').length):x).join('; '),host:'127.0.0.1:'+s.ports.api}},upstream=>{
        const cookies=upstream.headers['set-cookie'];
        if(cookies)upstream.headers['set-cookie']=cookies.map(x=>x.startsWith('refreshToken=')?'preview-'+s.runId+'-'+x:x);
        res.writeHead(upstream.statusCode||502,{...upstream.headers,[HEADER]:s.runId});upstream.pipe(res);
      });
      forwarded.setTimeout(30000,()=>forwarded.destroy());
      forwarded.once('error',()=>{if(!res.headersSent)send(res,503,{error:'PREVIEW_API_UNAVAILABLE'});else res.destroy();});
      req.once('aborted',()=>forwarded.destroy());req.pipe(forwarded);
    })().catch(()=>{if(!res.headersSent)send(res,503,{error:'PREVIEW_RESOURCE_UNVERIFIED'});else res.destroy();});
  });
  const media=createServer((req,res)=>{
    void (async()=>{
      if(!await guard(req,res,'media'))return;
      try {await verifyS3Signature(req,c.media.origin,Date.now(),s.mediaSecret);} catch {send(res,403,{error:'PREVIEW_S3_SIGNATURE_INVALID'});return;}
      const u=new URL(req.url||'/',c.media.origin);
      assert(u.pathname.startsWith('/preview/'),'只允许本会话桶');
      const key=decodeURIComponent(u.pathname.slice('/preview/'.length));
      assert(key&&!key.split('/').includes('..')&&!/[\0\\]/.test(key),'非法对象键');
      if(req.method==='DELETE')res.once('finish',()=>{if(res.statusCode>=200&&res.statusCode<300){tombstones.add(key);writePrivate(tombstoneFile,[...tombstones]);}});
      if(['GET','HEAD'].includes(req.method||'')&&req.headers['x-preview-local-only']!==s.runId)await prepareHistory(key);
      s3(req,res);
    })().catch(()=>{if(!res.headersSent)send(res,503,{error:'PREVIEW_MEDIA_UNAVAILABLE'});else res.destroy();});
  });
  await Promise.all([new Promise<void>((ok,fail)=>{backend.once('error',fail);backend.listen(s.ports.backend,'127.0.0.1',ok);}),new Promise<void>((ok,fail)=>{media.once('error',fail);media.listen(s.ports.media,'127.0.0.1',ok);})]);
  const finish=()=>{backend.close();media.close();backend.closeAllConnections();media.closeAllConnections();redis.disconnect();void db.$disconnect().finally(()=>process.exit(0));};
  process.once('SIGTERM',finish);process.once('SIGINT',finish);
}
if(require.main===module)void gateway(process.argv[2]).catch(()=>{console.error('预览网关启动失败');process.exit(1);});
