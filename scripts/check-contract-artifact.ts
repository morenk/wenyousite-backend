import * as fs from 'node:fs';

const generatedPath = process.argv[2] ?? '/tmp/wenyousite-openapi-check.json';
const trackedPath = 'contracts/openapi.json';

if (!fs.existsSync(trackedPath)) {
  throw new Error(`${trackedPath} 不存在；请运行 pnpm contract:generate`);
}
if (fs.readFileSync(generatedPath, 'utf8') !== fs.readFileSync(trackedPath, 'utf8')) {
  throw new Error('跟踪的 OpenAPI 合同已过期；请运行 pnpm contract:generate 并提交结果');
}
console.log('Tracked OpenAPI contract is current');
