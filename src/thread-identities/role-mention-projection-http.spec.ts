import { Controller, Get, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyReply } from 'fastify';
import { MediaDisplayInterceptor } from '../media/media-display.interceptor';
import { IdentityProjectionService } from './identity-projection.service';
import { PrismaService } from '../prisma/prisma.service';
const a='c00000000000000000000000a', b='c00000000000000000000000b';
const content=`[@同名](/users/user?rpIdentityId=${a}) [@同名](/users/user?rpIdentityId=${b}) [@同名](/users/user?identityMode=ACCOUNT)`;
const cached={id:'post',content,author:{id:'actor',username:'作者'},preview:'旧摘要'};
@Controller('posts') class ReadController {
  @Get(':id') get(@Res({passthrough:true}) reply:FastifyReply) { reply.header('Vary','Origin, Accept'); return cached; }
}
describe('角色提及 HTTP 能力投影和缓存隔离',()=>{
  let app:NestFastifyApplication;
  let enabled=true;
  beforeAll(async()=>{
    const db={
      post:{findMany:jest.fn(async()=>[{id:'post',content,authorIdentitySnapshot:null,identityAvatarMedia:null,author:{deletedAt:null},thread:{id:'thread',rpIdentityEnabled:enabled},diceRolls:[],mentionIdentitySnapshots:[
        {userId:'user',label:'同名',identityId:a,sourceHref:`/users/user?rpIdentityId=${a}`,targetIdentityId:a},
        {userId:'user',label:'同名',identityId:b,sourceHref:`/users/user?rpIdentityId=${b}`,targetIdentityId:b},
        {userId:'user',label:'同名',identityId:null,sourceHref:'/users/user?identityMode=ACCOUNT',targetIdentityId:null},
      ]}])}, user:{findMany:jest.fn(async()=>[{id:'user',username:'账号当前名'}])},
    };
    const module=await Test.createTestingModule({controllers:[ReadController]}).compile();
    app=module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalInterceptors(new MediaDisplayInterceptor({project:async(value:unknown)=>value} as never,new IdentityProjectionService(db as unknown as PrismaService)));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async()=>app.close());
  it('新→旧→新读不污染缓存，Vary合并既有值；关闭稳定target仍保留',async()=>{
    for (const state of [true,false,true]) {
      enabled=state;
      const next=await app.inject({method:'GET',url:'/posts/post',headers:{'X-Markdown-Contract-Version':'6'}});
      expect(next.statusCode).toBe(200); expect(next.headers.vary).toBe('Origin, Accept, X-Markdown-Contract-Version');
      const body=next.json(); expect(body.content).toBe(content);
      expect(body.mentionIdentities.map((row:{targetIdentityId:string|null})=>row.targetIdentityId)).toEqual([a,b,null]);
      expect(body.mentionIdentities.map((row:{displayName:string})=>row.displayName)).toEqual(state?['同名','同名','账号当前名']:['账号当前名','账号当前名','账号当前名']);
      const old=await app.inject({method:'GET',url:'/posts/post'}); const oldBody=old.json();
      expect(oldBody.content).not.toContain('rpIdentityId'); expect(JSON.stringify(oldBody)).not.toContain('同名');
      expect(JSON.stringify(oldBody)).not.toContain(a); expect(cached.content).toBe(content); expect(cached).not.toHaveProperty('mentionIdentities');
    }
  });
});
