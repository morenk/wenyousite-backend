import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDownloadUnit, validatePublicDownloadConfigText } from '../validate-download-security';
import { parseDownloadArgs } from '../../src/app-downloads/download-cli';
import { gatewayEnvironmentSafe } from '../../src/config/configuration';

test('公开进程无凭据/网络且缓存只读，拒绝模板降级', () => {
  const unit = readFileSync('ops/wenyousite-download.service', 'utf8'); validateDownloadUnit(unit);
  for (const changed of [unit.replace('PrivateNetwork=true', 'PrivateNetwork=false'), unit + '\nEnvironmentFile=/etc/wenyousite/download-origin.env', unit.replace('ReadOnlyPaths=', 'ReadWritePaths='), unit.replace('MemoryMax=256M', 'MemoryMax=1G'), unit.replace('User=wenyousite-download', 'User=root')]) assert.throws(() => validateDownloadUnit(changed));
});
test('复用凭据也不能继承到公开网关',()=>{
  assert(gatewayEnvironmentSafe({PATH:'/usr/bin'}));
  for(const key of ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','COS_ACCESS_KEY_ID','COS_SECRET_ACCESS_KEY','DOWNLOAD_S3_ACCESS_KEY_ID','DOWNLOAD_S3_SECRET_ACCESS_KEY'])assert.equal(gatewayEnvironmentSafe({[key]:'synthetic-private-value'}),false);
});
test('生产安装配置不接受 HTTP 预览 Cookie 模式或内联密钥',()=>{
  validatePublicDownloadConfigText(readFileSync('ops/secrets/download.env.example','utf8'));
  for(const text of ['DOWNLOAD_PREVIEW_RUN_ID=preview_'+'a'.repeat(24),'AWS_ACCESS_KEY_ID=synthetic','DOWNLOAD_S3_SECRET_ACCESS_KEY=synthetic'])assert.throws(()=>validatePublicDownloadConfigText(text));
});
test('CLI 拒绝任意密钥、路径参数与无发布证明晋级', () => {
  assert.equal(parseDownloadArgs(['warm', '--env', '/private/config', '--build', '42', '--origin-env', '/private/origin']).command, 'warm');
  for (const args of [['warm', '--env', '/x', '--build', '1', '--access-key', 'x'], ['publish', '--env', '/x', '--build', '1', '--published-at', '2026-10-02T00:00:00.000Z'], ['warm', '--env', '/x', '--env', '/y'], ['warm', '--env', '/x', '--build', '../1', '--origin-env', '/y']]) assert.throws(() => parseDownloadArgs(args));
});
