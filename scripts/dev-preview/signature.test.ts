import assert from 'node:assert/strict';
import test from 'node:test';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { verifyS3Signature } from './signature';

const origin='http://127.0.0.1:43888';
const config={endpoint:origin,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'S3RVER',secretAccessKey:'S3RVER'}};
test('SDK 预签名保持方法/path/query/headers；错误、过期与超前时间拒绝',async()=>{
  const client=new S3Client(config);
  const now=new Date('2026-09-26T01:00:00Z');
  const url=new URL(await getSignedUrl(client,new PutObjectCommand({Bucket:'preview',Key:'images/a b.png',ContentType:'image/png',ContentLength:10}),{expiresIn:600,signingDate:now}));
  const req={method:'PUT',url:url.pathname+url.search,headers:{host:url.host,'content-type':'image/png','content-length':'10'}};
  await verifyS3Signature(req,origin,now.getTime());
  await assert.rejects(()=>verifyS3Signature({...req,method:'DELETE'},origin,now.getTime()));
  await assert.rejects(()=>verifyS3Signature({...req,url:req.url.replace('a%20b','wrong')},origin,now.getTime()));
  await assert.rejects(()=>verifyS3Signature({...req,url:req.url+'&tampered=true'},origin,now.getTime()));
  await assert.rejects(()=>verifyS3Signature({...req,headers:{...req.headers,'content-length':'11'}},origin,now.getTime()));
  await assert.rejects(()=>verifyS3Signature({...req,headers:{...req.headers,host:'127.0.0.1:43889'}},origin,now.getTime()));
  await assert.rejects(()=>verifyS3Signature(req,origin,now.getTime()+601000));
  await assert.rejects(()=>verifyS3Signature(req,origin,now.getTime()-901000));
  const bad=new URL(url);bad.searchParams.set('X-Amz-Signature','0'.repeat(64));
  await assert.rejects(()=>verifyS3Signature({...req,url:bad.pathname+bad.search},origin,now.getTime()));
  client.destroy();
});
test('AWS SDK 内部 HEAD/PUT/DELETE header 签名兼容，匿名仅GET/HEAD',async()=>{
  const methods:string[]=[];
  const client=new S3Client({...config,requestHandler:{handle:async(request:any)=>{
    const query=new URLSearchParams(Object.entries(request.query||{}).flatMap(([key,value])=>Array.isArray(value)?value.map(v=>[key,String(v)]):[[key,String(value)]])).toString();
    await verifyS3Signature({method:request.method,headers:request.headers,url:request.path+(query?'?'+query:'')},origin);
    methods.push(request.method);
    return {response:{statusCode:200,headers:{etag:'"test"'},body:Readable.from([])}};
  }}});
  await client.send(new HeadObjectCommand({Bucket:'preview',Key:'image.png'}));
  await client.send(new PutObjectCommand({Bucket:'preview',Key:'image.png',Body:Buffer.from('image'),ContentType:'image/png'}));
  await client.send(new DeleteObjectCommand({Bucket:'preview',Key:'image.png'}));
  assert.deepEqual(methods,['HEAD','PUT','DELETE']);
  await verifyS3Signature({method:'GET',headers:{host:'127.0.0.1:43888'},url:'/preview/image.png'},origin);
  await assert.rejects(()=>verifyS3Signature({method:'PUT',headers:{host:'127.0.0.1:43888'},url:'/preview/image.png'},origin));
  client.destroy();
});

test('相同固定媒体端口拒绝其他批次的有效预签名 PUT',async()=>{
 const oldClient=new S3Client({...config,credentials:{accessKeyId:'S3RVER',secretAccessKey:'old-batch-secret'}});
 const url=new URL(await getSignedUrl(oldClient,new PutObjectCommand({Bucket:'preview',Key:'same-key.png',ContentType:'image/png'}),{expiresIn:600}));
 const req={method:'PUT',url:url.pathname+url.search,headers:{host:url.host,'content-type':'image/png'}};
 await verifyS3Signature(req,origin,Date.now(),'old-batch-secret');
 await assert.rejects(()=>verifyS3Signature(req,origin,Date.now(),'new-batch-secret'));
 oldClient.destroy();
});
