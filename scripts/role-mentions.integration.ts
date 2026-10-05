import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
const db = new PrismaClient();
type Data = Record<string, any>;
async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.ROLE_MENTIONS_TEST_ENV, 'test');
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const request = async (path: string, actor?: string, method='GET', body?: unknown, status=200, version: number | null=6): Promise<Data> => {
    await new Promise(resolve => setTimeout(resolve, 130));
    const response = await fetch(process.env.API_BASE + path, { method, headers: {
      ...(version ? { 'X-Markdown-Contract-Version': String(version) } : {}),
      ...(body === undefined ? {} : { 'content-type':'application/json' }),
      ...(actor ? { authorization:'Bearer '+jwt.sign({sub:actor,jti:randomUUID()},{expiresIn:'10m'}) } : {}),
    }, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(10000) });
    const value = await response.json() as Data;
    assert.equal(response.status,status,`role mentions ${method} status=${response.status} code=${value.code}`);
    if (status < 400) assert(response.headers.get('vary')?.toLowerCase().includes('x-markdown-contract-version'));
    return status < 400 ? value.data : value;
  };
  const user = () => db.user.create({ data:{ username:'v6_'+randomUUID().slice(0,12), email:randomUUID()+'@v6.invalid', password:'unused' } });
  const [owner,player,reader] = await Promise.all([user(),user(),user()]);
  const category = await db.threadCategoryDefinition.findFirstOrThrow({where:{isActive:true}});
  const thread = await db.thread.create({data:{ownerId:owner.id,title:'平级角色隔离样本',category:category.slug,published:true,rpIdentityEnabled:true,members:{create:[{userId:owner.id,role:'OWNER'},{userId:player.id,playerMarked:true}]}}});
  const sub = await db.subthread.create({data:{threadId:thread.id,title:'角色提及'}});
  await db.thread.update({where:{id:thread.id},data:{defaultSubthreadId:sub.id}});
  const base='/threads/'+thread.id, roles=base+'/rp-identities', postUrl='/subthreads/'+sub.id+'/posts';
  const a=await request(roles,player.id,'POST',{nickname:player.username},201);
  const b=await request(roles,player.id,'POST',{nickname:player.username},201);
  assert.notEqual(a.identityId,b.identityId);
  assert.equal((await request(roles,player.id)).defaultIdentityId,null);
  const candidates=await request('/users/mention-candidates?threadId='+thread.id+'&includeIdentities=true&q='+player.username,owner.id);
  const targets=candidates.users.filter((row:Data)=>row.id===player.id);
  assert.equal(targets.length,3); assert.equal(new Set(targets.map((row:Data)=>row.candidateKey)).size,3);
  const aSource=`[@${player.username}](/users/${player.id}?rpIdentityId=${a.identityId})`;
  const bSource=`[@${player.username}](/users/${player.id}?rpIdentityId=${b.identityId})`;
  const accountSource=`[@${player.username}](/users/${player.id}?identityMode=ACCOUNT)`;
  const content=`同名三目标 ${aSource} ${bSource} ${accountSource}`;
  const input={content,identityMode:'ACCOUNT',markdownContractVersion:6,clientRequestId:randomUUID()};
  const post=await request(postUrl,owner.id,'POST',input,201);
  assert.deepEqual(post.mentionIdentities.map((row:Data)=>row.targetIdentityId),[a.identityId,b.identityId,null]);
  assert.deepEqual(post.mentionIdentities.map((row:Data)=>row.sourceHref),targets.length ? [aSource,bSource,accountSource].map(source=>source.slice(source.indexOf('](')+2,-1)):[]);
  for (let attempt=0; attempt<30 && !await db.postMention.count({where:{postId:post.id,mentionedUserId:player.id}}); attempt++) await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await db.postMention.count({where:{postId:post.id,mentionedUserId:player.id}}),1);
  const newName='renamed'+randomUUID().slice(0,8);
  await request('/users/me',player.id,'PATCH',{username:newName});
  const afterRename=await request('/posts/'+post.id);
  assert.equal(afterRename.content,content);
  assert.deepEqual(afterRename.mentionIdentities.map((row:Data)=>row.displayName),[player.username,player.username,newName]);
  await request(postUrl,owner.id,'POST',{...input,clientRequestId:randomUUID()},201);
  for(const bad of [
    `[@${player.username}](/users/${player.id}?rpIdentityId=${a.identityId}&identityMode=ACCOUNT)`,
    `[@${player.username}](/users/${player.id}?rpIdentityId=${a.identityId}&rpIdentityId=${b.identityId})`,
    `[@${player.username}](/users/${reader.id}?rpIdentityId=${a.identityId})`,
    `[@假名](/users/${player.id}?rpIdentityId=${a.identityId})`,
    `[@假名](/users/${player.id}?identityMode=ACCOUNT)`,
  ]) assert.equal((await request(postUrl,owner.id,'POST',{...input,content:bad,clientRequestId:randomUUID()},409)).code,40012);
  assert.equal((await request(postUrl,owner.id,'POST',{content,identityMode:'ACCOUNT'},409)).code,40014);
  await request(base+'/identity-settings',owner.id,'PATCH',{enabled:false});
  const old=await request('/posts/'+post.id,undefined,'GET',undefined,200,null);
  assert(!old.content.includes('rpIdentityId')); assert(!old.content.includes(player.username));
  assert(!JSON.stringify(old.mentionIdentities).includes(a.identityId));
  const current=await request('/posts/'+post.id);
  assert.equal(current.content,content);
  assert.deepEqual(current.mentionIdentities.map((row:Data)=>row.displayName),[newName,newName,newName]);
  assert.deepEqual(current.mentionIdentities.map((row:Data)=>row.targetIdentityId),[a.identityId,b.identityId,null]);
  assert.equal((await request('/posts/'+post.id,owner.id,'PATCH',{content:'删除了所有提及',version:post.version},409,null)).code,40014);
  const edited=await request('/posts/'+post.id,owner.id,'PATCH',{content:content+' 调整文字',version:post.version,markdownContractVersion:6});
  assert.equal((await db.post.findUniqueOrThrow({where:{id:post.id}})).content,content+' 调整文字');
  await request(base+'/identity-settings',owner.id,'PATCH',{enabled:true});
  await request(roles+'/'+a.identityId,player.id,'DELETE',{version:a.identity.version});
  const moved=await request('/posts/'+post.id,owner.id,'PATCH',{content:`重排 ${bSource} ${aSource} ${accountSource}`,version:edited.version,markdownContractVersion:6});
  assert.equal(moved.mentionIdentities[1].targetIdentityId,a.identityId);
  assert.equal((await request(postUrl,owner.id,'POST',{...input,content:aSource,clientRequestId:randomUUID()},409)).code,40012);
  const other=await db.thread.create({data:{ownerId:owner.id,title:'跨主题拒绝',category:category.slug,published:true,rpIdentityEnabled:true,members:{create:{userId:owner.id,role:'OWNER'}}}});
  const otherSub=await db.subthread.create({data:{threadId:other.id,title:'另主题'}});
  assert.equal((await request('/subthreads/'+otherSub.id+'/posts',owner.id,'POST',{...input,content:bSource,clientRequestId:randomUUID()},409)).code,40012);
  const draft=await request('/drafts',owner.id,'POST',{content:bSource,markdownContractVersion:6},201);
  const oldDraft=await request('/drafts/'+draft.id,owner.id,'GET',undefined,200,null);
  assert(!oldDraft.content.includes('rpIdentityId'));
  assert.equal((await request('/drafts/'+draft.id,owner.id,'PATCH',{content:oldDraft.content,version:draft.version},409,null)).code,40014);
  assert.equal((await request('/drafts',owner.id,'POST',{slot:draft.slot,content:'旧覆盖',version:draft.version},409,null)).code,40014);
  assert.equal((await request('/drafts/'+draft.id,owner.id)).content,bSource);
  await request('/drafts/'+draft.id,owner.id,'PATCH',{content:accountSource,version:draft.version,markdownContractVersion:6});
  const createdThread=await request('/threads',owner.id,'POST',{title:'账号提及初始草稿',content:accountSource,markdownContractVersion:6},201);
  assert.equal(createdThread.subthreads[0].bodyPost.content,accountSource);
  assert.equal((await request('/threads',owner.id,'POST',{title:'拒绝跨主题角色',content:bSource,markdownContractVersion:6},409)).code,40012);
  const firstBody=await request('/subthreads/'+sub.id+'/body',owner.id,'PUT',{content:bSource,identityMode:'ACCOUNT',markdownContractVersion:6});
  assert.equal((await request('/subthreads/'+sub.id+'/body',owner.id,'PUT',{content:'旧端覆盖',version:firstBody.version},409,null)).code,40014);
  const authors=await request('/subthreads/'+sub.id+'/posts/authors');
  assert((authors as unknown as Data[]).every((row:Data)=>!row.rpIdentity));
  const header=await request(base); assert.equal(header.owner.rpIdentity,null);
  // 导出需实际流式解压，数据只进入本轮内存，不落公网或共享目录。
  const { inflateRawSync }=await import('node:zlib');
  for (const version of [null,6]) {
    const response=await fetch(process.env.API_BASE+base+'/export',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+jwt.sign({sub:owner.id,jti:randomUUID()},{expiresIn:'10m'}),...(version?{'X-Markdown-Contract-Version':'6'}:{})},body:JSON.stringify({includeMedia:false})});
    assert.equal(response.status,200);
    const bytes=Buffer.from(await response.arrayBuffer()); const entries=new Map<string,string>();
    for(let i=0;i+46<bytes.length;i++) if(bytes.readUInt32LE(i)===0x02014b50){
      const method=bytes.readUInt16LE(i+10), size=bytes.readUInt32LE(i+20),nameLen=bytes.readUInt16LE(i+28),local=bytes.readUInt32LE(i+42);
      const name=bytes.subarray(i+46,i+46+nameLen).toString(); const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      const data=bytes.subarray(start,start+size); entries.set(name,(method===8?inflateRawSync(data):data).toString());
    }
    assert.equal(entries.has('identity-sources.json'),version===6);
    if(version){ const sources=JSON.parse(entries.get('identity-sources.json')!); assert(sources.posts.some((row:Data)=>row.postId===post.id&&row.content.includes('?rpIdentityId='))); }
    for(const [name,value] of entries) if(name.endsWith('.md')||name.endsWith('.txt')) assert(!value.includes('?rpIdentityId='));
    await new Promise(resolve=>setTimeout(resolve,1100));
  }
  console.log('Role mention isolation: stable same-name targets, account alias, legacy projection/write guard, close/archive, cross-thread, draft, BODY, directory, export passed');
}
main().finally(()=>db.$disconnect()).catch(error=>{ console.error(error);process.exitCode=1; });
