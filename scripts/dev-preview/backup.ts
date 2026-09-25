import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { businessDate, environment, hash, privateDirectory, privateFile, Snapshot, writePrivate } from './common';
import { validateHistoricalMap, readSnapshot } from './snapshot';

export function mediaMap(rows:Array<Record<string,unknown>>,origin:string) {
  const map:Record<string,string>={};
  for(const row of rows){
    const key=row.key;const url=row.url;
    if(typeof key!=='string'||typeof url!=='string'||!url.endsWith('/'+key))continue;
    const prefix=url.slice(0,-key.length);
    const scan=(value:unknown)=>{
      if(typeof value==='string'&&value.startsWith(prefix)){
        const candidate=decodeURIComponent(value.slice(prefix.length));
        try{validateHistoricalMap({[candidate]:value},origin);map[candidate]=value;}catch{/* 非登记媒体源不授权。 */}
      }else if(Array.isArray(value))value.forEach(scan);
      else if(value&&typeof value==='object')Object.values(value).forEach(scan);
    };
    scan(row);
  }
  return map;
}
export function parseCopy(text:string) {
  const tables:Record<string,Array<Record<string,unknown>>>={};
  let table='';let columns:string[]=[];
  const decode=(value:string):string|null=>value==='\\N'?null:value.replace(/\\([\\tnrbfv])/g,(_,c:string)=>({'\\':'\\',t:'\t',n:'\n',r:'\r',b:'\b',f:'\f',v:'\v'}[c]!));
  for(const line of text.split('\n')){
    const start=line.match(/^COPY public\.(\w+) \(([^)]+)\) FROM stdin;$/);
    if(start){table=start[1];columns=start[2].split(', ').map(x=>x.replace(/^"|"$/g,''));tables[table]=[];continue;}
    if(line==='\\.'){table='';continue;}
    if(!table)continue;
    const cells=line.split('\t');assert.equal(cells.length,columns.length,'备份 COPY 行损坏');
    const row:Record<string,unknown>={};
    columns.forEach((column,index)=>{
      const value=decode(cells[index]);
      row[column]=['display_asset','preview_variants'].includes(column)&&value?JSON.parse(value):value;
    });
    tables[table].push(row);
  }
  return tables;
}
/** 优先选择当天既有逻辑备份；SHA sidecar 与 TOC 均需验证，不执行导出 SQL。 */
export function importDailyBackup(args:{backupRoot:string;output:string;sourceSha:string;mediaOrigin:string;pgBin:string}) {
  privateDirectory(resolve(args.backupRoot));
  const candidates=readdirSync(args.backupRoot).map(name=>{
    const m=name.match(/^wenyousite_postgres_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/);
    if(!m)return undefined;
    const capturedAt=m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+'Z';
    return businessDate(new Date(capturedAt))===businessDate()?{name,capturedAt}:undefined;
  }).filter((x):x is {name:string;capturedAt:string}=>!!x).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
  if(!candidates.length)return undefined;
  const {name,capturedAt}=candidates[0];const dump=privateFile(join(args.backupRoot,name));
  const sha256=hash(readFileSync(dump));
  const sidecar=readFileSync(privateFile(dump+'.sha256'),'utf8').trim();
  assert(sidecar===sha256+'  '+name||sidecar===sha256+' *'+name,'既有逻辑备份校验失败');
  execFileSync(join(args.pgBin,'pg_restore'),['--list',dump],{env:environment(),stdio:'pipe'});
  const sql=execFileSync(join(args.pgBin,'pg_restore'),['--data-only','--table=_prisma_migrations','--table=media','--table=sticker_assets','--file=-',dump],{env:environment(),encoding:'utf8',maxBuffer:128*1024*1024});
  const tables=parseCopy(sql);
  const migrations=tables._prisma_migrations?.filter(x=>x.finished_at&&!x.rolled_back_at).map(x=>String(x.migration_name)).sort();
  assert(migrations?.length,'备份缺少 migration');
  const media=mediaMap([...(tables.media||[]),...(tables.sticker_assets||[])],args.mediaOrigin);
  const parent=privateDirectory(resolve(args.output),true);
  const target=join(parent,businessDate(new Date(capturedAt)));
  if(existsSync(target))return readSnapshot(target).metadata;
  const staging=join(parent,'.import-'+process.pid);mkdirSync(staging,{mode:0o700});
  copyFileSync(dump,join(staging,'database.dump'));chmodSync(join(staging,'database.dump'),0o600);
  writePrivate(join(staging,'media.json'),media);
  const metadata:Snapshot={version:1,capturedAt,businessDate:businessDate(new Date(capturedAt)),sha256,sourceSha:args.sourceSha,migrationVersion:migrations.at(-1)!,mediaSha256:hash(readFileSync(join(staging,'media.json'))),mediaOrigin:args.mediaOrigin};
  writePrivate(join(staging,'snapshot.json'),metadata);renameSync(staging,target);
  return metadata;
}
/** 只交付三个快照文件；源凭据与整个备份目录从不交给开发身份。 */
export function publishSnapshot(sourceRoot:string,publishRoot:string,date:string) {
  assert(process.getuid?.()===0,'发布快照需要管理身份');
  const destination=resolve(publishRoot);const stat=lstatSync(destination);
  assert(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid!==0&&(stat.mode&0o777)===0o700&&realpathSync(destination)===destination,'发布根必须是开发身份的私有真实目录');
  const target=join(destination,date);
  if(existsSync(target)){
    for(const name of ['snapshot.json','database.dump','media.json']){
      privateFile(join(target,name),stat.uid);
      assert.equal(hash(readFileSync(join(target,name))),hash(readFileSync(join(sourceRoot,date,name))),'已发布快照发生变化');
    }
    return;
  }
  const temp=join(destination,'.publish-'+process.pid);mkdirSync(temp,{mode:0o700});
  for(const name of ['snapshot.json','database.dump','media.json']){
    copyFileSync(privateFile(join(sourceRoot,date,name)),join(temp,name));chmodSync(join(temp,name),0o600);chownSync(join(temp,name),stat.uid,stat.gid);
  }
  chownSync(temp,stat.uid,stat.gid);renameSync(temp,target);
}
