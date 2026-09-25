import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { IncomingMessage } from 'node:http';
import { hash } from './common';

/** s3rver 的 V4 校验未实现；网关验证 AWS SigV4 canonical request，保持预签名 Host/端口语义。 */
export async function verifyS3Signature(req:Pick<IncomingMessage,'method'|'headers'|'url'>,origin:string,now=Date.now()) {
  if(req.method==='OPTIONS')return;
  const url=new URL(req.url||'/',origin);
  const rawPath=(req.url||'/').split('?',1)[0];
  assert(url.origin===origin&&rawPath.startsWith('/')&&!rawPath.startsWith('//'),'S3 请求目标非法');
  const query=url.searchParams;
  const authorization=req.headers.authorization;
  const presigned=query.has('X-Amz-Algorithm');
  if(!authorization&&!presigned) {
    assert(['GET','HEAD'].includes(req.method||''),'S3 写入必须签名');return;
  }
  assert(!(authorization&&presigned),'S3 签名机制冲突');
  let credential:string;let signedHeaders:string;let signature:string;let date:string;
  if(presigned){
    assert.equal(query.get('X-Amz-Algorithm'),'AWS4-HMAC-SHA256','签名算法非法');
    credential=query.get('X-Amz-Credential')||'';
    signedHeaders=query.get('X-Amz-SignedHeaders')||'';
    signature=query.get('X-Amz-Signature')||'';date=query.get('X-Amz-Date')||'';
    assert([...query.keys()].every(key=>query.getAll(key).length===1),'重复签名参数');
  }else{
    const parsed=authorization?.match(/^AWS4-HMAC-SHA256 Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]{64})$/);
    assert(parsed,'S3 Authorization 非法');
    [,credential,signedHeaders,signature]=parsed;
    date=String(req.headers['x-amz-date']||'');
  }
  assert(/^[a-f0-9]{64}$/.test(signature)&&/^\d{8}T\d{6}Z$/.test(date),'签名时间或摘要非法');
  const stamp=Date.parse(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)+'T'+date.slice(9,11)+':'+date.slice(11,13)+':'+date.slice(13,15)+'Z');
  const expires=presigned?Number(query.get('X-Amz-Expires')):900;
  assert(Number.isInteger(expires)&&expires>=1&&expires<=604800&&Number.isFinite(stamp)&&stamp<=now+900000&&now<=stamp+expires*1000,'S3 签名过期');
  const [access,day,region,service,terminal,...rest]=credential.split('/');
  assert(access==='S3RVER'&&day===date.slice(0,8)&&region==='us-east-1'&&service==='s3'&&terminal==='aws4_request'&&rest.length===0,'S3 凭据范围非法');
  const headers=signedHeaders.split(';');
  assert(headers.includes('host')&&[...headers].sort().join(';')===signedHeaders&&new Set(headers).size===headers.length,'签名头非法');
  assert.equal(req.headers.host,new URL(origin).host,'S3 Host 必须匹配同端口地址');
  const selected:Record<string,string>={};
  for(const name of headers){
    assert(/^[a-z0-9-]+$/.test(name)&&req.headers[name]!==undefined,'签名头缺失');
    const value=req.headers[name];assert(typeof value==='string','签名头不可重复');selected[name]=value;
  }
  selected['x-amz-content-sha256']=presigned?'UNSIGNED-PAYLOAD':String(req.headers['x-amz-content-sha256']||hash(''));
  // 用同一官方签名器重建 canonical request；query 的 signature 字段由其规范化逻辑排除。
  const signer=new SignatureV4({service:'s3',region:'us-east-1',credentials:{accessKeyId:'S3RVER',secretAccessKey:'S3RVER'},sha256:Sha256,uriEscapePath:false,applyChecksum:false});
  const unsigned=new Set(['x-amz-date','x-amz-content-sha256'].filter(name=>!headers.includes(name)));
  const signed=await signer.sign(new HttpRequest({protocol:url.protocol,hostname:url.hostname,port:Number(url.port),method:req.method,path:rawPath,query:Object.fromEntries(query.entries()),headers:selected}),{signingDate:new Date(stamp),unsignableHeaders:unsigned});
  const result=signed.headers.authorization.match(/SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/);
  assert(result&&result[1]===signedHeaders,'签名头规范不符');
  assert(timingSafeEqual(Buffer.from(result[2],'hex'),Buffer.from(signature,'hex')),'S3 签名不符');
}
