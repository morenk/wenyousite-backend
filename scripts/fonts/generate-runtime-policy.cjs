const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { policyOf } = require('./runtime-policy.cjs');
const Ajv = require('ajv');
const root = resolve(__dirname, '../..');
const manifestBytes = readFileSync(resolve(root, 'contracts/thread-font-manifest-v1.json'));
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(resolve(root, 'contracts/thread-font-manifest-v1.schema.json'))));
if (!validate(JSON.parse(manifestBytes))) throw new Error('runtime_policy_invalid_manifest');
const policy = policyOf(manifestBytes);
const json = JSON.stringify(policy, null, 2);
for (const [name, bytes] of [
  ['contracts/thread-font-runtime-policy-v2.json', json + '\n'],
  ['src/common/text-font-runtime-policy.generated.ts', '// 由 scripts/fonts/generate-runtime-policy.cjs 生成；快照账本不是内存上限。\nexport const TEXT_FONT_RUNTIME_POLICY = ' + json + ' as const;\n'],
]) {
  const target = resolve(root, name);
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== bytes) throw new Error(name + ': runtime_policy_outdated');
  } else writeFileSync(target, bytes);
}
console.log('字体运行策略 v2 与 manifest 快照账本一致');
