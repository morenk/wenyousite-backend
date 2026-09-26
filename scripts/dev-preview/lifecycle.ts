import { assertExclusive, assertFixed, bootId, FIXED_PORTS, processesAlive, withControlLock } from './control';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { unusedPort } from '../e2e-resources';
import { businessDate, consumer, databaseUrl, environment, load, privateDirectory, REPO, safeName, safePort, save, Session, sessionRoot, sha, sourceEvidence, stateRoot, verifyConsumer, writePrivate } from './common';
import { readSnapshot } from './snapshot';
import { alive, clients, launch, runTool, stop, verifyResources, waitFor } from './resources';

export async function withLock<T>(name:string,use:()=>Promise<T>) { safeName(name); return withControlLock(use); }
async function available(port:number) {
  const server=createServer();
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()));
}
function toolPaths() {
  const pg=process.env.E2E_PG_BIN;
  const redis=process.env.E2E_REDIS_BIN;
  assert(pg&&redis,'需配置只读 E2E_PG_BIN/E2E_REDIS_BIN');
  assert(pg.startsWith('/')&&redis.startsWith('/')&&existsSync(join(pg,'initdb'))&&existsSync(redis),'隔离二进制路径无效');
  return {pg,redis,library:process.env.E2E_LIBRARY_PATH};
}
async function create(name:string,args:Record<string,string>) {
  const snapshotPath=args.snapshot || join(process.env.PREVIEW_SNAPSHOT_ROOT || join(homedir(),'.local/state/wenyousite-preview-snapshots'),businessDate());
  const snapshot=readSnapshot(snapshotPath);
  const tools=toolPaths();
  const root=sessionRoot(name);
  const ports={} as Session['ports'];
  assert(!args['web-port']||Number(args['web-port'])===FIXED_PORTS.web,'Web 预览端口固定为 4310');
  Object.assign(ports,FIXED_PORTS);
  for(const key of ['postgres','redis','api'] as const) {
    do { ports[key]=safePort(await unusedPort()); } while(Object.values(ports).filter(x=>x===ports[key]).length>1);
  }
  const secret=()=>randomBytes(32).toString('hex');
  mkdirSync(root,{mode:0o700});
  const s:Session={ version:1,sessionId:name,runId:'preview_'+randomBytes(12).toString('hex'),root,worktree:REPO,uid:process.getuid!(),state:'initializing',initialized:false,backendSha:sha(),...sourceEvidence(),snapshot:snapshot.metadata,ports,secrets:{owner:secret(),app:secret(),redis:secret(),jwt:secret(),pepper:secret()},processes:[],tools,bootId:bootId(),mediaSecret:secret() };
  save(s);
  writePrivate(join(root,'ownership.json'),{runId:s.runId,root,uid:s.uid,worktree:REPO});
  copyFileSync(snapshot.dump,join(root,'database.dump'));
  const {chmodSync}=await import('node:fs'); chmodSync(join(root,'database.dump'),0o600);
  writePrivate(join(root,'historical-media.json'),snapshot.media);
  for(const dir of ['socket','uploads','mailbox']) mkdirSync(join(root,dir),{mode:0o700});
  writeFileSync(join(root,'postgres.password'),s.secrets.owner,{mode:0o600,flag:'wx'});
  runTool(s,join(tools.pg,'initdb'),['-D',join(root,'postgres'),'-U','preview_owner','--pwfile',join(root,'postgres.password'),'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);
  return s;
}
async function sanitize(s:Session) {
  const {db,redis}=clients(s,true);
  try {
    await verifyResources(s,db,redis);
    runTool(s,join(s.tools.pg,'pg_restore'),['--no-owner','--no-acl','--exit-on-error','--dbname','postgres',join(s.root,'database.dump')],{PGHOST:'127.0.0.1',PGPORT:String(s.ports.postgres),PGUSER:'preview_owner',PGPASSWORD:s.secrets.owner});
    const migrations=await db.$queryRawUnsafe<Array<{migration_name:string}>>('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1');
    assert.equal(migrations[0]?.migration_name,s.snapshot.migrationVersion,'恢复 migration 与快照不符');
    // 只对新建且刚验证身份的独立实例执行迁移与净化。
    runTool(s,process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',join(REPO,'prisma/schema.prisma')],{DATABASE_URL:databaseUrl(s,true),DIRECT_DATABASE_URL:databaseUrl(s,true)});
    await db.$transaction(async tx=>{
      await tx.refreshToken.deleteMany(); await tx.adminSession.deleteMany(); await tx.adminAuthChallenge.deleteMany();
      await tx.adminInvite.deleteMany(); await tx.emailVerification.deleteMany(); await tx.mobileDevice.deleteMany();
      await tx.threadInvite.deleteMany(); await tx.domainOutbox.deleteMany(); await tx.mediaPreviewAttempt.deleteMany();
      await tx.systemNotificationCampaign.updateMany({where:{status:{in:['SCHEDULED','SENDING']}},data:{status:'CANCELED',canceledAt:new Date()}});
      await tx.stickerImport.updateMany({where:{status:'PROCESSING'},data:{status:'FAILED',failureCode:'PREVIEW_SNAPSHOT_RESET',failureMessage:'预览快照已取消历史处理任务'}});
      await tx.media.updateMany({where:{status:{in:['UPLOADING','PROCESSING']}},data:{status:'FAILED',processingStartedAt:null}});
      await tx.media.updateMany({where:{displayStatus:'PROCESSING'},data:{displayStatus:'FAILED',displayStartedAt:null}});
    },{timeout:60000});
    await db.$executeRawUnsafe("CREATE ROLE wenyousite_app LOGIN PASSWORD '"+s.secrets.app+"' NOSUPERUSER NOCREATEDB NOCREATEROLE");
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wenyousite_app');
    await db.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wenyousite_app');
    await db.$executeRawUnsafe('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wenyousite_app');
    s.initialized=true; save(s);
  } finally {redis.disconnect();await db.$disconnect();}
}
function appEnvironment(s:Session):NodeJS.ProcessEnv {
  const c=consumer(s);
  return {...environment(s),NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(s.ports.api),
    DATABASE_URL:databaseUrl(s),DIRECT_DATABASE_URL:databaseUrl(s),
    REDIS_HOST:'127.0.0.1',REDIS_PORT:String(s.ports.redis),REDIS_DB:'0',REDIS_PASSWORD:s.secrets.redis,
    JWT_ACCESS_SECRET:s.secrets.jwt,ADMIN_CHALLENGE_PEPPER:s.secrets.pepper,PUSH_ENABLED:'false',SENTRY_DSN:'',
    SES_SMTP_HOST:'',SES_SMTP_USER:'',SES_SMTP_PASS:'',SES_FROM_ADDRESS:'preview@preview.invalid',PREVIEW_MAILBOX_DIR:join(s.root,'mailbox'),
    GOOGLE_APPLICATION_CREDENTIALS:'',COS_ENDPOINT:c.media.origin,COS_REGION:'us-east-1',COS_BUCKET:'preview',COS_ACCESS_KEY_ID:'S3RVER',COS_SECRET_ACCESS_KEY:s.mediaSecret!,
    ENABLE_API_DOCS:'false',LOG_LEVEL:'info',BUILD_SHA:s.backendSha,APP_URL:c.backend.origin,WEB_APP_URL:c.web.origin,CORS_ORIGINS:c.web.origin,
    TS_NODE_PROJECT:join(REPO,'tsconfig.json')};
}
export async function start(name:string,args:Record<string,string>) {
  assert(process.getuid?.()!==0,'预览进程禁止 root');
  await assertExclusive(name);
  let s:Session;
  const existing=existsSync(sessionRoot(name));
  if(existing) {
    s=load(name);
    if(args.confirm)assert.equal(args.confirm,s.runId,'runId 已变化');
    assertFixed(s);
    if(s.state==='ready'&&s.mediaSecret&&s.bootId) { try { await verifyConsumer(s); return s; } catch { /* 自有失活会话可按登记安全恢复。 */ } }
    assert(s.initialized,'初始化未完成；需显式 reset');
    assert(!args['web-port']||Number(args['web-port'])===s.ports.web,'已有会话端口不可隐式变更');
    await stop(s);
    s.bootId=bootId();s.mediaSecret ||= randomBytes(32).toString('hex');
    s.state='initializing';s.backendSha=sha();Object.assign(s,sourceEvidence());save(s);
  } else s=await create(name,args);
  try {
    for(const port of Object.values(s.ports)) await available(port);
    launch(s,'postgres',join(s.tools.pg,'postgres'),['-D',join(s.root,'postgres'),'-h','127.0.0.1','-p',String(s.ports.postgres),'-k','', '-c','cluster_name='+s.runId,'-c','max_connections=50']);
    writeFileSync(join(s.root,'redis.conf'),'bind 127.0.0.1\nport '+s.ports.redis+'\nrequirepass '+s.secrets.redis+'\ndir '+s.root+'\nappendonly yes\nappendfsync everysec\nsave ""\n',{mode:0o600});
    launch(s,'redis',s.tools.redis,[join(s.root,'redis.conf')]);
    const {db,redis}=clients(s,true);
    try {
      await waitFor(async()=>{
        assert(alive(s,'postgres')&&alive(s,'redis'));
        const row=await db.$queryRawUnsafe<Array<{cluster_name:string}>>('SHOW cluster_name');
        assert.equal(row[0]?.cluster_name,s.runId);
        if(redis.status!=='ready') await redis.connect();
        await redis.ping();
      },'隔离数据库启动失败');
      s.redisInstance=(await redis.info('server')).match(/^run_id:(\w+)/m)?.[1];
      assert(s.redisInstance,'缺少 Redis 身份');
      const marker=await redis.get('preview:ownership');
      assert(!marker||marker===s.runId,'Redis 归属漂移');
      await redis.set('preview:ownership',s.runId);save(s);
      await verifyResources(s,db,redis);
    } finally {redis.disconnect();await db.$disconnect();}
    if(!s.initialized) await sanitize(s);
    launch(s,'gateway',process.execPath,['--import',require.resolve('tsx'),join(REPO,'scripts/dev-preview/gateway.ts'),s.sessionId],{PREVIEW_STATE_ROOT:stateRoot()});
    const env=appEnvironment(s);
    launch(s,'api',process.execPath,['--require',require.resolve('ts-node/register/transpile-only'),join(REPO,'src/main.ts')],env);
    launch(s,'worker',process.execPath,['--require',require.resolve('ts-node/register/transpile-only'),join(REPO,'src/image-worker.ts')],env);
    await waitFor(async()=>{
      assert(alive(s,'gateway')&&alive(s,'api')&&alive(s,'worker'));
      const response=await fetch('http://127.0.0.1:'+s.ports.api+'/api/v1/health',{signal:AbortSignal.timeout(1000)});
      assert(response.ok);
      await verifyConsumer(s);
    },'API/媒体/Worker 启动失败',240);
    s.state='ready';save(s);writePrivate(join(s.root,'consumer.json'),consumer(s));
    return s;
  } catch {
    await stop(s);s.state='failed';save(s);
    throw new Error('预览启动失败；已停止自有进程，私有目录保留诊断');
  }
}
export async function cleanup(s:Session,confirm:string) {
  assert.equal(confirm,s.sessionId,'必须显式确认批次名');
  assert(s.state==='stopped'||s.state==='failed','先 stop 再 cleanup');
  await stop(s);
  load(s.sessionId); privateDirectory(s.root);
  assert(s.root===sessionRoot(s.sessionId)&&s.root!==stateRoot(),'清理范围越界');
  rmSync(s.root,{recursive:true});
}
export async function reset(name:string,args:Record<string,string>) {
  const s=load(name);
  assert.equal(args.confirm,s.sessionId,'必须显式确认批次名');
  // 先验证新快照，损坏或过期时保留当前可用实例。
  readSnapshot(args.snapshot||join(process.env.PREVIEW_SNAPSHOT_ROOT||join(homedir(),'.local/state/wenyousite-preview-snapshots'),businessDate()));
  await stop(s);await cleanup(s,args.confirm);
  return start(name,{...args,'web-port':args['web-port']||String(s.ports.web)});
}

export async function rebind(name:string,confirm:string) {
  const s=load(name);assert.equal(confirm,s.runId,'必须确认精确 runId');
  assert(!processesAlive(s),'必须先暂停全部自有进程');
  assert(['stopped','failed'].includes(s.state),'先 pause 再 rebind');
  assertRebindSafe(s);
  Object.assign(s.ports,FIXED_PORTS);
  assert(new Set(Object.values(s.ports)).size===Object.values(s.ports).length,'内部端口与固定端口冲突，保留数据并停止');
  s.mediaSecret ||= randomBytes(32).toString('hex');save(s);return s;
}

export function assertRebindSafe(s:Session) {
  if(s.ports.media===FIXED_PORTS.media)return;
  const uploads=join(s.root,'uploads');
  const inspect=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
    assert(!entry.isSymbolicLink(),'媒体目录归属不可核验');
    if(entry.isDirectory())inspect(join(dir,entry.name));
    else assert(entry.isFile()&&entry.name==='._S3rver_cors.xml','PREVIEW_MEDIA_REBIND_REQUIRES_MIGRATION: 旧端口已有媒体对象；先独立迁移引用，保留原归属与数据');
  }};
  if(existsSync(uploads))inspect(uploads);
}
