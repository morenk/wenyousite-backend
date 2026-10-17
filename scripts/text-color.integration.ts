import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { inflateRawSync } from 'node:zlib';
const db = new PrismaClient();
type Data = Record<string, any>;
const color = (value: string, rgb = '#D14343') => `<span data-wenyou-color-v1="${rgb}">${value}</span>`;
async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.TEXT_COLOR_TEST_ENV, 'test');
  const enabled = process.env.TEXT_COLOR_V1_ENABLED === 'true';
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const user = await db.user.create({ data: { username: 'color_'+randomUUID().slice(0,10), email: randomUUID()+'@color.invalid', password: 'unused' } });
  const headers = (capable = true) => ({'content-type':'application/json', authorization:'Bearer '+jwt.sign({sub:user.id,jti:randomUUID()},{expiresIn:'10m'}), ...(capable ? {'X-Text-Color-Version':'1'} : {})});
  const request = async (path: string, method='GET', body?: unknown, status=200, capable=true): Promise<Data> => {
    await new Promise(resolve=>setTimeout(resolve,150));
    const response = await fetch(process.env.API_BASE+path,{method,headers:headers(capable),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const value = await response.json() as Data;
    assert.equal(response.status,status,`text-color ${method} ${path.split('/')[1]} status=${response.status} code=${value.code}`);
    if(status<400) assert(response.headers.get('vary')?.toLowerCase().includes('x-text-color-version'));
    return status<400?value.data:value;
  };
  const meta=await request('/meta'); assert.equal(meta.capabilities.textColorV1Supported,true); assert.equal(meta.capabilities.textColorV1WriteEnabled,enabled); assert.equal(meta.markdownContractVersion,5);
  const category=await db.threadCategoryDefinition.findFirstOrThrow({where:{isActive:true}});
  const thread=await db.thread.create({data:{ownerId:user.id,title:'文本颜色隔离样本',category:category.slug,published:true,members:{create:{userId:user.id,role:'OWNER'}}}});
  const sub=await db.subthread.create({data:{threadId:thread.id,title:'颜色子帖'}});
  await db.thread.update({where:{id:thread.id},data:{defaultSubthreadId:sub.id}});
  const raw='前段\n[wenyousite-align-v1-center]: #\n'+color('**彩色正文**')+' 普通文字\n[wenyousite-align-v1-right]: #\n'+color('*靠右正文*');
  const legacy='前段\n[wenyousite-align-v1-center]: #\n**彩色正文** 普通文字\n[wenyousite-align-v1-right]: #\n*靠右正文*';
  const floor=await request('/subthreads/'+sub.id+'/posts','POST',{content:'初始无色楼层'},201);
  await db.post.update({where:{id:floor.id},data:{content:raw}});
  const body=await db.post.create({data:{threadId:thread.id,subthreadId:sub.id,authorId:user.id,kind:'BODY',content:raw}});
  const draft=await db.draft.create({data:{userId:user.id,slot:1,content:raw}});
  for(const capable of [false,true,false,true]) {
    const got=await request('/posts/'+floor.id,'GET',undefined,200,capable);
    assert.equal(got.content,capable?raw:legacy);
    const threadGot=await request('/threads/'+thread.id,'GET',undefined,200,capable);
    assert.equal(threadGot.subthreads[0].bodyPost.content,capable?raw:legacy);
    const drafts=await request('/drafts/state','GET',undefined,200,capable);
    assert.equal(drafts.drafts[0].content,capable?raw:legacy);
  }

  // 合法空段与紧邻彩色标题：真实 PATCH/读取/旧端降级，并验证关闭新写时保源。
  const emptyHeading='<br />\n## '+color('彩色正文');
  const adjacentHeadings='### '+color('小标题')+'\n## '+color('彩色正文');
  const emptyFloor=await db.post.create({data:{threadId:thread.id,subthreadId:sub.id,authorId:user.id,kind:'FLOOR',floorNumber:99,content:adjacentHeadings}});
  const emptyUpdated=await request('/posts/'+emptyFloor.id,'PATCH',{content:emptyHeading,version:emptyFloor.version,textColorVersion:1});
  assert.equal(emptyUpdated.content,emptyHeading);
  assert.equal((await request('/posts/'+emptyFloor.id,'GET')).content,emptyHeading);
  assert.equal((await request('/posts/'+emptyFloor.id,'GET',undefined,200,false)).content,'<br />\n## 彩色正文');
  assert.equal((await request('/posts/'+emptyFloor.id,'PATCH',{content:'旧端覆盖',version:emptyUpdated.version},409,false)).code,40016);
  assert.equal((await request('/posts/'+emptyFloor.id,'PATCH',{content:'<br />\n<div>'+color('恶意')+'</div>',version:emptyUpdated.version,textColorVersion:1},400)).code,40018);
  const emptyDraft=await db.draft.create({data:{userId:user.id,slot:2,content:adjacentHeadings}});
  assert.equal((await request('/drafts/'+emptyDraft.id,'PATCH',{content:emptyHeading,version:emptyDraft.version,textColorVersion:1})).content,emptyHeading);

  const oldWrite={content:'去掉全部颜色',version:floor.version};
  assert.equal((await request('/posts/'+floor.id,'PATCH',oldWrite,409,false)).code,40016);
  assert.equal((await request('/drafts/'+draft.id,'PATCH',{content:'旧端草稿覆盖',version:draft.version},409,false)).code,40016);
  assert.equal((await request('/drafts','POST',{content:'旧端槽覆盖',slot:1,version:draft.version},409,false)).code,40016);
  assert.equal((await request('/subthreads/'+sub.id+'/body','PUT',{content:'旧端BODY覆盖',version:body.version},409,false)).code,40016);
  const current=await db.thread.findUniqueOrThrow({where:{id:thread.id}});
  const aggregate={content:'旧端聚合覆盖',version:current.version,defaultSubthreadVersion:sub.version,bodyVersion:body.version,tagNames:[]};
  assert.equal((await request('/threads/'+thread.id+'/aggregate','PATCH',aggregate,409,false)).code,40016);
  for(const id of [floor.id,body.id]) assert.equal((await db.post.findUniqueOrThrow({where:{id}})).content,raw);
  assert.equal((await db.draft.findUniqueOrThrow({where:{id:draft.id}})).content,raw);
  const postPath='/subthreads/'+sub.id+'/posts';
  assert.equal((await request(postPath,'POST',{content:color('新颜色')},409)).code,40016);
  assert.equal((await request(postPath,'POST',{content:'<span data-wenyou-color-v1="#123456" onclick="x">攻击</span>',textColorVersion:1},400)).code,40018);
  const creation: Array<[string, Data]> = [
    [postPath,{content:color('楼层'),textColorVersion:1}],
    [postPath,{content:color('回复'),textColorVersion:1,parentPostId:floor.id}],
    ['/threads',{title:'有色主题草稿',content:color('主题'),textColorVersion:1}],
    ['/threads/'+thread.id+'/subthreads',{title:'有色子帖',content:color('子帖'),textColorVersion:1}],
    ['/drafts',{content:color('草稿'),textColorVersion:1}],
  ];
  for(const [path,input] of creation) {
    const got=await request(path,'POST',input,enabled?201:409);
    if(!enabled) assert.equal(got.code,40017);
  }
  if(!enabled) {
    assert.equal((await request('/posts/'+floor.id,'PATCH',{content:color('新颜色'),version:floor.version,textColorVersion:1},409)).code,40017);
  }
  let updated=await request('/posts/'+floor.id,'PATCH',{content:raw+' 后续文字',version:floor.version,textColorVersion:1});
  assert.equal(updated.content,raw+' 后续文字');
  updated=await request('/posts/'+floor.id,'PATCH',{content:'恢复默认色',version:updated.version,textColorVersion:1});
  assert.equal(updated.content,'恢复默认色');
  await request('/drafts/'+draft.id,'PATCH',{content:raw+' 草稿追加',version:draft.version,textColorVersion:1});
  await request('/subthreads/'+sub.id+'/body','PUT',{content:raw+' BODY追加',version:body.version,textColorVersion:1});
  const freshBody=await db.post.findUniqueOrThrow({where:{id:body.id}});
  await request('/threads/'+thread.id+'/aggregate','PATCH',{...aggregate,content:raw+' 聚合追加',bodyVersion:freshBody.version,textColorVersion:1});
  assert.equal((await db.post.findUniqueOrThrow({where:{id:body.id}})).content,raw+' 聚合追加');
  // ZIP 沿用既有规则移除对齐标记；去色不能先将标记转义而泄漏到正文。全程仅内存解压。
  for(const capable of [true,false]) {
    let response!:Response;
    for(let attempt=0;attempt<3;attempt++) {
      response=await fetch(process.env.API_BASE+'/threads/'+thread.id+'/export',{method:'POST',headers:headers(capable),body:JSON.stringify({includeMedia:false}),signal:AbortSignal.timeout(20000)});
      if(response.status!==429) break;
      await response.arrayBuffer();
      await new Promise(resolve=>setTimeout(resolve,Math.min(60,Number(response.headers.get('retry-after')??60))*1000+100));
    }
    assert.equal(response.status,200); assert(response.headers.get('vary')?.toLowerCase().includes('x-text-color-version'));
    const bytes=Buffer.from(await response.arrayBuffer()); let markdownFound=false;
    for(let i=0;i+46<bytes.length;i++) if(bytes.readUInt32LE(i)===0x02014b50) {
      const method=bytes.readUInt16LE(i+10),size=bytes.readUInt32LE(i+20),nameLength=bytes.readUInt16LE(i+28),local=bytes.readUInt32LE(i+42);
      const name=bytes.subarray(i+46,i+46+nameLength).toString(),start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      const data=bytes.subarray(start,start+size),text=(method===8?inflateRawSync(data):data).toString();
      if(name.endsWith('.md')) { markdownFound=true; assert.equal(text.includes('data-wenyou-color-v1'),capable); assert(!text.includes('wenyousite-align')); assert(!text.includes('wenyousite\\-align')); assert(text.includes('靠右正文')); }
      if(name.endsWith('.txt')) assert(!text.includes('data-wenyou-color-v1'));
    }
    assert(markdownFound);
  }
  console.log('Text color isolation passed: '+(enabled?'write enabled':'write closed')+', legacy read/write, drafts, BODY, aggregate, all creation paths, export');
}
main().finally(()=>db.$disconnect()).catch(error=>{console.error(error);process.exitCode=1;});
