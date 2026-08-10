import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const trackedPath = 'contracts/openapi.json';
const currentText = fs.readFileSync(trackedPath, 'utf8');
const current = JSON.parse(currentText) as Record<string, any>;
const version = current.info?.version;
const changelog = fs.readFileSync('contracts/CHANGELOG.md', 'utf8');

if (typeof version !== 'string' || !changelog.includes(`## ${version}`)) {
  throw new Error(`OpenAPI 版本 ${String(version)} 缺少对应 CHANGELOG 记录`);
}

try {
  const previousText = execFileSync('git', ['show', 'HEAD:contracts/openapi.json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const previous = JSON.parse(previousText) as Record<string, any>;
  if (previousText !== currentText && previous.info?.version === version) {
    throw new Error(`OpenAPI 内容已变化但版本仍为 ${version}；禁止同版本不同契约`);
  }
} catch (error) {
  if (error instanceof Error && error.message.includes('禁止同版本不同契约')) throw error;
  // 新仓库或尚无历史产物时只检查当前版本与 CHANGELOG。
}

console.log(`OpenAPI version discipline is valid (${version})`);
