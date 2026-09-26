import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020';
import { businessDate, consumer, hash, REPO, safeName, safePort, Session, writePrivate } from './common';
import { publicIPv4 } from './history';
import { readSnapshot, validateHistoricalMap } from './snapshot';
import { parseArgs } from './cli';
import { mediaMap, parseCopy } from './backup';
import { withLock } from './lifecycle';
import { stateRoot } from './common';

test('北京时间日期、保留端口、批次名与 CLI 参数拒绝',()=>{
  assert.equal(businessDate(new Date('2026-09-25T16:01:00Z')),'2026-09-26');
  for(const port of [3000,3001,5432,6379,0,65536,4.1])assert.throws(()=>safePort(port));
  for(const name of ['../foo','ab','Aaa','foo/bar'])assert.throws(()=>safeName(name));
  assert.throws(()=>parseArgs(['--session','abc','--session','def']));
});
test('媒体只允许快照登记源与公网 IPv4',()=>{
  validateHistoricalMap({'a/x.png':'https://media.example.com/bucket/a/x.png'},'https://media.example.com');
  for(const url of ['http://media.example.com/a/x.png','https://evil.example/a/x.png','https://media.example.com/a/x.png?q=1','https://x@media.example.com/a/x.png'])assert.throws(()=>validateHistoricalMap({'a/x.png':url},'https://media.example.com'));
  for(const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','172.31.0.1','192.168.1.1','169.254.1.1','::1','::ffff:8.8.8.8','224.1.1.1'])assert.equal(publicIPv4(ip),false);
  assert.equal(publicIPv4('8.8.8.8'),true);
});
test('快照哈希损坏与过期拒绝，时间绑定同一北京时间业务日',()=>{
  const root=mkdtempSync(join(tmpdir(),'preview-unit-'));
  try {
    writeFileSync(join(root,'database.dump'),'fake dump',{mode:0o600});
    writePrivate(join(root,'media.json'),{});
    const metadata={version:1,capturedAt:new Date().toISOString(),businessDate:businessDate(),sha256:hash('fake dump'),sourceSha:'a'.repeat(40),migrationVersion:'migration',mediaSha256:hash(readFileSync(join(root,'media.json'))),mediaOrigin:'https://media.example.com'};
    writePrivate(join(root,'snapshot.json'),metadata);
    assert.equal(readSnapshot(root).metadata.sha256,metadata.sha256);
    writeFileSync(join(root,'database.dump'),'tampered');
    assert.throws(()=>readSnapshot(root));
    writeFileSync(join(root,'database.dump'),'fake dump');
    writePrivate(join(root,'snapshot.json'),{...metadata,capturedAt:'2020-01-01T01:00:00Z',businessDate:'2020-01-01'});
    assert.throws(()=>readSnapshot(root));
    assert.doesNotThrow(()=>readSnapshot(root,false));
  }finally{rmSync(root,{recursive:true});}
});
test('实际消费者样例通过 JSON schema 且没有 secret/db 字段',()=>{
  const s={sessionId:'sample-preview',runId:'preview_'+'a'.repeat(24),uid:1000,backendSha:'b'.repeat(40),worktree:'/srv/worktree',snapshot:{capturedAt:new Date().toISOString(),businessDate:businessDate(),sha256:'c'.repeat(64),sourceSha:'d'.repeat(40),migrationVersion:'version'},ports:{backend:41000,media:41001,web:41002}} as Session;
  const c=consumer(s);
  const validate=new Ajv().compile(JSON.parse(readFileSync(join(REPO,'contracts/dev-preview-session.schema.json'),'utf8')));
  assert(validate(c),JSON.stringify(validate.errors));
  assert(!JSON.stringify(c).includes('secrets'));
  c.web.port=3001;assert.equal(validate(c),false);
});

test('历史对象映射包含派生图且移除 bucket 前缀',()=>{
 const result=mediaMap([{key:'media/a.png',url:'https://media.example.com/bucket/media/a.png',poster_url:'https://media.example.com/bucket/media/a-poster.webp',display_asset:{url:'https://media.example.com/bucket/media/a-display.webp'}}],'https://media.example.com');
 assert.deepEqual(Object.keys(result),['media/a.png','media/a-poster.webp','media/a-display.webp']);
 const tables=parseCopy('COPY public.media (key, url, display_asset) FROM stdin;\na\thttps://media.example/a\t\\N\n\\.\n');
 assert.equal(tables.media[0].display_asset,null);
});
test('不同会话与状态根竞争同一个主机锁',async()=>{
 const name='unit-lock-'+process.pid;
 let release:()=>void=()=>{};
 const held=withLock(name,()=>new Promise<void>(ok=>{release=ok;}));
 await new Promise(ok=>setTimeout(ok,150));
 const original=process.env.PREVIEW_STATE_ROOT;const other=mkdtempSync(join(tmpdir(),'preview-lock-'));
 process.env.PREVIEW_STATE_ROOT=other;
 try{await assert.rejects(()=>withLock('another-session',async()=>{}));}
 finally{if(original===undefined)delete process.env.PREVIEW_STATE_ROOT;else process.env.PREVIEW_STATE_ROOT=original;release();await held;rmSync(other,{recursive:true});}
 await withLock(name,async()=>{});
});
