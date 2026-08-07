import * as fs from 'node:fs';
import * as path from 'node:path';

const failures: string[] = [];
const checks: Array<[string, RegExp, string]> = [
  ['docs/frontend-guide.md', /\/posts\/:id\/like/, '仍引用旧楼层点赞路由'],
  ['docs/frontend-guide.md', /\/notifications\/:id\/read/, '仍引用旧通知已读路由'],
  ['docs/frontend-guide.md', /未读通知数[^\n]*\{\s*count\s*:/, '仍声明旧 count 字段'],
  ['docs/frontend-guide.md', /jpg\/png\/gif\/webp\/bmp\/svg/i, '仍把 BMP/SVG 写入上传白名单'],
  ['docs/frontend-guide.md', /accessToken[^\n]*localStorage/i, '仍建议把 access token 写入 localStorage'],
  ['docs/api-validation.md', /"statusCode"\s*:\s*400/, '仍展示 Nest 原始异常而非统一 envelope'],
  ['docs/api-validation.md', /所有数据库主键\/外键 ID 字段必须添加[\s\S]{0,160}@IsUUID/, '仍把 CUID 主键描述为 UUID'],
  ['docs/notification-delivery.md', /PostsService\.like\(\)/, '仍引用已经迁移的点赞服务'],
  ['docs/modules/direct-messages.md', /不支持[^\n。]*推送/, '仍声称私聊不支持推送'],
];
for (const [file, pattern, message] of checks) {
  const source = fs.readFileSync(file, 'utf8');
  if (pattern.test(source)) failures.push(`${file}: ${message}`);
}

const backendFixture = fs.readFileSync('contracts/markdown-v2-fixtures.json', 'utf8');
const frontendFixture = path.resolve('../wenyousite-frontend/contracts/markdown-v2-fixtures.json');
if (fs.existsSync(frontendFixture) && fs.readFileSync(frontendFixture, 'utf8') !== backendFixture) {
  failures.push('前后端 Markdown v2 黄金语料不一致');
}

if (failures.length > 0) throw new Error(`文档事实检查失败：\n${failures.join('\n')}`);
console.log('Documentation truth checks passed');
