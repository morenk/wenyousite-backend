import { MentionsService } from './mentions.service';
import { ConfigService } from '@nestjs/config';

describe('平级角色提及候选', () => {
  function setup(enabled = true) {
    const user = { id: 'user', username: '同名', avatar: null };
    const db = {
      userFollow: { findMany: jest.fn().mockResolvedValue([]) },
      threadMember: { findMany: jest.fn().mockResolvedValue([{userId:user.id,role:'PARTICIPANT',playerMarked:true,user}]) },
      thread: { findUnique: jest.fn().mockResolvedValue({ownerId:'owner',visibility:'PUBLIC',rpIdentityEnabled:true}) },
      threadIdentity: { findMany: jest.fn().mockResolvedValue([
        {id:'a',userId:user.id,nickname:'同名',avatarMediaId:null},
        {id:'b',userId:user.id,nickname:'同名',avatarMediaId:'removed',avatarMedia:{status:'FAILED',url:'removed-url',displayAsset:{}}},
      ]) },
    };
    const legacy={projectCurrent:jest.fn()};
    const blocks={loadBlockSets:jest.fn().mockResolvedValue({}),filterRecipients:jest.fn((ids:string[])=>ids)};
    const service = new MentionsService(db as never,{assertAccessible:jest.fn()} as never,blocks as never,legacy as never,{get:()=>enabled} as unknown as ConfigService);
    return {db,service,legacy,blocks};
  }
  it('同账号同名 A/B/ACCOUNT 三个稳定目标并列，不调用兼容主身份投影',async()=>{
    const {service,legacy}=setup();
    const rows=await service.findCandidates('thread','owner','同名',true);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(row=>row.candidateKey))).toEqual(new Set(['ACCOUNT:user','RP:a','RP:b']));
    expect(rows.find(row=>row.candidateKey==='ACCOUNT:user')).toMatchObject({mentionHref:'/users/user?identityMode=ACCOUNT',rpIdentity:null});
    expect(rows.find(row=>row.candidateKey==='RP:b')?.rpIdentity).toMatchObject({avatar:null,avatarDisplay:null});
    expect(legacy.projectCurrent).not.toHaveBeenCalled();
  });
  it('写入未开放时 opt-in 空列表，不回落旧候选',async()=>{
    const {service,legacy,db}=setup(false);
    expect(await service.findCandidates('thread','owner',undefined,true)).toEqual([]);
    expect(legacy.projectCurrent).not.toHaveBeenCalled(); expect(db.threadIdentity.findMany).not.toHaveBeenCalled();
  });
  it('账号不可见时同时排除它的所有角色',async()=>{
    const {service,blocks}=setup(); blocks.filterRecipients.mockReturnValue([]);
    expect(await service.findCandidates('thread','owner',undefined,true)).toEqual([]);
  });
});
