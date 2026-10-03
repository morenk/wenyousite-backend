import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, open, writeFile, symlink, readFile, readdir, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { DownloadBudget, DownloadInstanceLock, beijingPeriods } from '../../src/app-downloads/download-budget';
import { DownloadPublisher } from '../../src/app-downloads/download-publisher';
import { parseAndroidManifest, inspectApk } from '../../src/app-downloads/download-apk';
import { selectRange } from '../../src/app-downloads/download-range';
import { Admission, Bandwidth, trustedIp } from '../../src/app-downloads/download-limits';
import { DownloadCache } from '../../src/app-downloads/download-cache';
import { isolatedFiles, apkFixture } from './fixture';

const origin = (buffer: Buffer, calls: { head: number; get: number }) => ({ async head() { calls.head++; }, async get() { calls.get++; return Readable.from([buffer]); }, close() {} });
test('Range 严格单段、后缀、If-Range 和越界', () => {
  assert.deepEqual(selectRange('bytes=-10', 100), { start: 90, end: 99, length: 10, partial: true });
  assert.equal(selectRange('bytes=10-', 100).length, 90);
  assert.equal(selectRange('bytes=10-999', 100).length, 90);
  assert.equal(selectRange('bytes=10-20', 100, 'old', 'new').partial, false);
  for (const range of ['bytes=0-1,3-4', 'bytes=100-', 'bytes=-0', 'bytes=4-2', 'items=1-2', 'bytes=-', 'bytes=9007199254740992-', ' bytes=1-2']) assert.throws(() => selectRange(range, 100, 'old', 'new'));
});
test('IP 标准化、滑动窗口和无等待并发拒绝', () => {
  assert.equal(trustedIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(trustedIp('2001:0db8::1'), '2001:db8::1');
  for (const ip of ['1.2.3.4, 5.6.7.8', '', undefined]) assert.throws(() => trustedIp(ip));
  const a = new Admission(); for (let i = 0; i < 30; i++) a.request('a', i);
  assert.throws(() => a.request('a', 50000), { status: 429 }); a.request('a', 60000);
  const releases = [a.acquire('a'), a.acquire('a'), a.acquire('b'), a.acquire('b')];
  assert.throws(() => a.acquire('a'), { status: 429 }); assert.throws(() => a.acquire('c'), { status: 429 });
  releases.forEach(r => { r(); r(); }); assert.equal(a.count(), 0);
});
test('预算持久、事务并发、跨日月、回拨与损坏拒绝', async () => {
  const { root, config } = await isolatedFiles();
  try {
    const path = join(config.DOWNLOAD_EGRESS_DIR, 'budget.sqlite'), now = Date.parse('2026-10-31T15:59:59Z');
    let budget = new DownloadBudget(path, 'egress', { day: 100, month: 150 }); budget.reserve(60, now); budget.close();
    budget = new DownloadBudget(path, 'egress', { day: 100, month: 150 });
    assert.throws(() => budget.reserve(41, now), { status: 429 }); assert.equal(budget.status(now).dayReservedBytes, 60);
    budget.reserve(100, now + 2000); assert.equal(budget.status(now + 2000).monthReservedBytes, 100); assert.throws(() => budget.reserve(1, now), { status: 503 }); budget.close();
    assert.equal(beijingPeriods(now).day, '2026-10-31'); assert.equal(beijingPeriods(now + 1000).day, '2026-11-01');
    const script = `const {DownloadBudget}=require(${JSON.stringify(require.resolve('../../src/app-downloads/download-budget'))});const b=new DownloadBudget(process.argv[1],'egress',{day:1000,month:1000});let successes=0;for(let i=0;i<4;i++){try{b.reserve(100,1793462402000);successes++}catch{}}b.close();console.log(successes)`;
    const results = await Promise.all(Array.from({ length: 3 }, () => new Promise<number>((resolve, reject) => { const p = spawn(process.execPath, ['--require', 'ts-node/register/transpile-only', '-e', script, path], { stdio: ['ignore', 'pipe', 'pipe'] }); let output=''; p.stdout.on('data', chunk=>output+=chunk); p.on('error',reject); p.on('exit',code=>code===0?resolve(Number(output.trim())):reject(new Error('budget child failed'))); })));
    assert.equal(results.reduce((n, value)=>n+value,0), 9);
    budget = new DownloadBudget(path, 'egress', { day: 1000, month: 1000 }); assert.equal(budget.status(1793462402000).monthReservedBytes, 1000); budget.close();
    budget = new DownloadBudget(path, 'egress', { day: 1000, month: 1000 });
    await rename(path, path+'.old'); DownloadBudget.initialize(path,'egress');
    assert.throws(()=>budget.reserve(1,1793462402000)); budget.close();
    assert.throws(() => DownloadBudget.initialize(path, 'egress'));
    const lockPath = join(config.DOWNLOAD_EGRESS_DIR, 'gateway-lock.sqlite'), first = new DownloadInstanceLock(lockPath);
    assert.throws(() => new DownloadInstanceLock(lockPath)); first.close(); new DownloadInstanceLock(lockPath).close();
    await writeFile(path, 'corrupt'); assert.throws(() => new DownloadBudget(path, 'egress', { day: 1000, month: 1000 }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('在线修复保留在途旧 inode，旧文件继续计入容量且仅离线裁剪清理', async()=>{
  const {root,config}=await isolatedFiles(), {artifact,buffer}=apkFixture();
  try {
    const p=new DownloadPublisher(config), calls={head:0,get:0}; await p.register(artifact); await p.warm(42,origin(buffer,calls));
    await p.publish(42,'2026-10-02T00:00:00.000Z');
    const held=await p.cache.open(artifact);
    try {
      await new Promise(ok=>setTimeout(ok,20)); await p.warm(42,origin(buffer,calls),true);
      const old=await held.stat(); assert.equal(old.nlink,1); assert.notEqual(old.ino,(await stat(p.cache.path(artifact))).ino);
      const files=await readdir(config.DOWNLOAD_CACHE_DIR); assert.equal(files.length,2);
      assert.equal((await Promise.all(files.map(n=>stat(join(config.DOWNLOAD_CACHE_DIR,n))))).reduce((n,s)=>n+s.size,0),2*buffer.length);
      assert.deepEqual(await held.readFile(),buffer);
    } finally { await held.close(); }
    await p.prune(); assert.equal((await readdir(config.DOWNLOAD_CACHE_DIR)).length,1);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('发布入口 umask 077 不阻止公共进程通过只读组读取缓存，账本仍私有',async()=>{
  const previous=process.umask(0o077);
  let root:string|undefined;
  try {
    const isolated=await isolatedFiles(); root=isolated.root;
    const {config}=isolated, {artifact,buffer}=apkFixture(), p=new DownloadPublisher(config);
    assert.equal((await stat(join(config.DOWNLOAD_CATALOG_DIR,'catalog.json'))).mode & 0o777,0o640);
    await p.register(artifact); await p.warm(42,origin(buffer,{head:0,get:0}));
    assert.equal((await stat(p.cache.path(artifact))).mode & 0o777,0o640);
    assert.equal((await stat(join(config.DOWNLOAD_CATALOG_DIR,'catalog.json'))).mode & 0o777,0o640);
    assert.equal((await stat(join(config.DOWNLOAD_ORIGIN_DIR,'budget.sqlite'))).mode & 0o777,0o600);
  } finally {process.umask(previous);if(root)await rm(root,{recursive:true,force:true});}
});
test('流式预热合并、实际 APK 身份校验、原子缓存和符号链接拒绝', async () => {
  const { root, config } = await isolatedFiles(), { artifact, buffer } = apkFixture();
  try {
    const p = new DownloadPublisher(config), calls = { head: 0, get: 0 }; await p.register(artifact);
    await Promise.all([p.warm(42, origin(buffer, calls)), p.warm(42, origin(buffer, calls))]); assert.equal(calls.get, 1); assert.equal(calls.head, 1);
    await p.publish(42, '2026-10-02T00:00:00.000Z');
    const cache = new DownloadCache(config.DOWNLOAD_CACHE_DIR, config.DOWNLOAD_CATALOG_DIR), file = await cache.open(artifact); await inspectApk(file, artifact); await file.close();
    const before = await readFile(cache.path(artifact));
    const corrupt = Buffer.from(buffer); corrupt[0] = 0; await assert.rejects(p.warm(42, origin(corrupt, calls), true)); assert.deepEqual(await readFile(cache.path(artifact)), before);
    await rm(cache.path(artifact)); await symlink(join(root, 'ownership.json'), cache.path(artifact)); await assert.rejects(cache.open(artifact));
    const wrong = apkFixture(43, 16384, 'other.application'); await p.register(wrong.artifact); await assert.rejects(p.warm(43, origin(wrong.buffer, calls)));
    assert.throws(() => parseAndroidManifest(Buffer.alloc(8)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('限速并发公平且每连接仅一个等待块', async () => {
  const bandwidth = new Bandwidth(), signal = AbortSignal.timeout(10000), ids = [bandwidth.add(), bandwidth.add(), bandwidth.add(), bandwidth.add()];
  const timer = setInterval(() => {}, 1000);
  try {
    const start = performance.now(), finishes: number[] = [];
    await Promise.all(ids.map(async id => { for (let i = 0; i < 8; i++) await bandwidth.take(id, 8192, signal); finishes.push(performance.now() - start); }));
    assert.ok(Math.min(...finishes) > 350); assert.ok(Math.max(...finishes) - Math.min(...finishes) < 150);
    const waiting = bandwidth.take(ids[0], 8192, signal); assert.throws(() => bandwidth.take(ids[0], 8192, signal)); await waiting;
  } finally { clearInterval(timer); bandwidth.close(); }
});
test('SIGKILL 后账本保留已提交预留，不因未开始发送而退款', async () => {
  const { root, config } = await isolatedFiles();
  const path = join(config.DOWNLOAD_EGRESS_DIR, 'budget.sqlite');
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const script = `const {DownloadBudget}=require(${JSON.stringify(require.resolve('../../src/app-downloads/download-budget'))});const b=new DownloadBudget(process.argv[1],'egress',{day:1000,month:1000});b.reserve(700);console.log('reserved');setInterval(()=>{},1000)`;
    child = spawn(process.execPath, ['--require', 'ts-node/register/transpile-only', '-e', script, path], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((ok, fail) => { child!.stdout!.once('data',()=>ok()); child!.once('error',fail); child!.once('exit',()=>fail(new Error('crash fixture exited before reservation'))); });
    const exited = new Promise(ok=>child!.once('exit',ok)); child.kill('SIGKILL'); await exited; child = undefined;
    const b = new DownloadBudget(path, 'egress', { day: 1000, month: 1000 }); assert.equal(b.status().dayReservedBytes, 700); assert.throws(()=>b.reserve(301), {status:429}); b.close();
  } finally { child?.kill('SIGKILL'); await rm(root, { recursive: true, force: true }); }
});
test('离线裁剪保留推荐与两个历史包，撤回不能借 pause/resume 复活', async () => {
  const { root, config } = await isolatedFiles();
  try {
    const p = new DownloadPublisher(config), fixtures = [1,2,3,4].map(n=>apkFixture(n));
    for (const f of fixtures) { await p.register(f.artifact); await p.warm(f.artifact.buildNumber, origin(f.buffer,{head:0,get:0})); await p.publish(f.artifact.buildNumber, '2026-10-02T00:00:00.000Z'); }
    await p.prune();
    await assert.rejects(p.cache.open(fixtures[0].artifact));
    for (const f of fixtures.slice(1)) { const file = await p.cache.open(f.artifact); await file.close(); }
    await p.policy('withdraw'); await assert.rejects(p.policy('pause')); await assert.rejects(p.policy('resume'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
