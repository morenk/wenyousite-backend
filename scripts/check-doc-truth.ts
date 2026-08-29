import * as fs from 'node:fs';
import * as path from 'node:path';

const failures: string[] = [];
const checks: Array<[string, RegExp, string]> = [
  ['docs/frontend-guide.md', /\/posts\/:id\/like/, '仍引用旧楼层点赞路由'],
  ['docs/frontend-guide.md', /\/notifications\/:id\/read/, '仍引用旧通知已读路由'],
  ['docs/frontend-guide.md', /未读通知数[^\n]*\{\s*count\s*:/, '仍声明旧 count 字段'],
  ['docs/frontend-guide.md', /jpg\/png\/gif\/webp\/bmp\/svg/i, '仍把 BMP/SVG 写入上传白名单'],
  [
    'docs/frontend-guide.md',
    /accessToken[^\n]*localStorage/i,
    '仍建议把 access token 写入 localStorage',
  ],
  ['docs/api-validation.md', /"statusCode"\s*:\s*400/, '仍展示 Nest 原始异常而非统一 envelope'],
  [
    'docs/api-validation.md',
    /所有数据库主键\/外键 ID 字段必须添加[\s\S]{0,160}@IsUUID/,
    '仍把 CUID 主键描述为 UUID',
  ],
  ['docs/notification-delivery.md', /PostsService\.like\(\)/, '仍引用已经迁移的点赞服务'],
  ['docs/modules/direct-messages.md', /不支持[^\n。]*推送/, '仍声称私聊不支持推送'],
];
for (const [file, pattern, message] of checks) {
  const source = fs.readFileSync(file, 'utf8');
  if (pattern.test(source)) failures.push(`${file}: ${message}`);
}

const moduleGuides = fs
  .readdirSync('docs/modules')
  .filter((name) => name.endsWith('.md'))
  .map((name) => path.join('docs/modules', name));
const currentGuides = [
  'docs/architecture.md',
  'docs/data-model.md',
  'docs/frontend-guide.md',
  'docs/mobile-client-guide.md',
  'docs/mobile-ui-contract.md',
  ...moduleGuides,
];
const historicalPlanningPatterns: Array<[RegExp, string]> = [
  [/本次迭代|本轮迭代|本轮补充|后续迭代/, '混入迭代计划'],
  [/发布批次|跨端发布批次|批次标识/, '混入发布批次记录'],
  [/^##[^\n]*合同迁移[^\n]*$/m, '混入已完成合同迁移章节'],
  [/^#{2,4}[^\n]*验证记录[^\n]*$/m, '混入一次性验证记录'],
  [/Phase\s*\d|Roadmap/i, '混入阶段或路线图'],
  [/^\s*- \[[ xX]\]\s+/m, '混入任务清单'],
];
for (const file of currentGuides) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [pattern, message] of historicalPlanningPatterns) {
    if (pattern.test(source)) failures.push(`${file}: ${message}`);
  }
}

const openApiSource = fs.readFileSync('src/common/swagger/openapi-document.ts', 'utf8');
const contractVersion = openApiSource.match(/API_CONTRACT_VERSION\s*=\s*'([^']+)'/)?.[1];
if (!contractVersion) {
  failures.push('无法从 openapi-document.ts 读取 API_CONTRACT_VERSION');
} else {
  for (const file of ['docs/architecture.md', 'docs/frontend-guide.md']) {
    if (fs.readFileSync(file, 'utf8').includes(contractVersion)) {
      failures.push(`${file}: 手写复制当前契约版本 ${contractVersion}`);
    }
  }
}

if (/Vitest/.test(fs.readFileSync('AGENTS.md', 'utf8'))) {
  failures.push('AGENTS.md: 后端测试框架仍误写为 Vitest');
}
const frontendGuide = fs.readFileSync('docs/frontend-guide.md', 'utf8');
if (/错误码速查|\|\s*code\s*\|\s*含义\s*\|/i.test(frontendGuide)) {
  failures.push('docs/frontend-guide.md: 仍维护手写错误码速查表');
}
const mobileGuide = fs.readFileSync('docs/mobile-client-guide.md', 'utf8');
for (const claim of [
  'mobileCompatibility',
  'X-Client-Platform: mobile',
  'SESSION_NOT_FOUND',
  'DELETE /api/v1/mobile/devices/current',
  'getInitialMessage',
  'thread-category-v3-fixtures.json',
  'editorPasteCases',
  '/join/{token}',
  'momentsCommentContext',
  'momentCommentNavigation',
]) {
  if (!mobileGuide.includes(claim)) failures.push(`docs/mobile-client-guide.md: 缺少 ${claim}`);
}
for (const file of ['docs/README.md', 'docs/api-contract.md', 'docs/mobile-client-guide.md']) {
  if (/\b\d+\s*(?:个 operationId|项移动覆盖清单)/u.test(fs.readFileSync(file, 'utf8'))) {
    failures.push(`${file}: 不应手写复制易漂移的 operationId 总数`);
  }
}
const mobileUiBoundary = fs.readFileSync('docs/mobile-ui-contract.md', 'utf8');
for (const claim of ['external-source', 'morenk/wenyousite-foundation', 'foundation.lock.json']) {
  if (!mobileUiBoundary.includes(claim)) failures.push(`docs/mobile-ui-contract.md: 缺少 ${claim}`);
}
if (mobileUiBoundary.includes('pending-client-integration')) {
  failures.push('docs/mobile-ui-contract.md: 仍把已接入的 Flutter 设计基础标记为待接入');
}

for (const fixtureName of [
  'markdown-v4-fixtures.json',
  'markdown-v4-nodes-fixtures.json',
  'markdown-editor-roundtrip-v6-fixtures.json',
]) {
  const backendFixture = fs.readFileSync(path.join('contracts', fixtureName), 'utf8');
  for (const client of ['wenyousite-frontend', 'wenyousite-mobile']) {
    const clientFixture = path.resolve(`../${client}/contracts/${fixtureName}`);
    if (fs.existsSync(clientFixture) && fs.readFileSync(clientFixture, 'utf8') !== backendFixture) {
      failures.push(`${client} 的 ${fixtureName} 与后端不一致`);
    }
  }
}

if (failures.length > 0) throw new Error(`文档事实检查失败：\n${failures.join('\n')}`);
console.log('Documentation truth checks passed');
