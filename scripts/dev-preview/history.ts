import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { isIP } from 'node:net';
import { validateHistoricalMap } from './snapshot';

export function publicIPv4(address:string) {
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||(b===88&&c===99)))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&c===113));
}
/** 固定解析后的公网 IPv4，避免检查 DNS 后由连接再次解析造成 rebinding。 */
export async function historicalDownload(key:string,map:Record<string,string>,origin:string) {
  assert(Object.hasOwn(map,key),'对象未登记在快照');
  validateHistoricalMap({[key]:map[key]},origin);
  const url=new URL(map[key]);
  const addresses=await lookup(url.hostname,{all:true,family:4});
  assert(addresses.length>0&&addresses.every(x=>publicIPv4(x.address)),'历史媒体 DNS 非公网');
  const address=addresses[0].address;
  return new Promise<{body:Buffer;contentType:string}>((ok,fail)=>{
    const req=get(url,{family:4,lookup:(_hostname,_opts,callback)=>callback(null,address,4),timeout:10000},response=>{
      if(response.statusCode!==200){response.resume();fail(new Error('历史媒体只允许无重定向的成功 GET'));return;}
      const chunks:Buffer[]=[];let bytes=0;
      response.on('data',(chunk:Buffer)=>{
        bytes+=chunk.length;
        if(bytes>32*1024*1024){response.destroy(new Error('历史媒体超过大小限制'));return;}
        chunks.push(chunk);
      });
      response.once('error',fail);
      response.once('end',()=>ok({body:Buffer.concat(chunks),contentType:response.headers['content-type']||'application/octet-stream'}));
    });
    req.once('timeout',()=>req.destroy(new Error('历史媒体读取超时')));req.once('error',fail);
  });
}
