import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { backendResults, compareResults, loadContract, validateContract, type Results } from './validation';

try {
  const { fixture, fixtureSha256, validateResult } = loadContract();
  const errors = validateContract(fixture);
  if (errors.length) throw new Error(errors[0]);
  const [mode, resultPath] = process.argv.slice(2);
  if (mode === '--backend') {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const result = backendResults(fixture, fixtureSha256, revision);
    if (!validateResult(result)) throw new Error('backend-result-schema-invalid');
    console.log(JSON.stringify(result, null, 2));
  } else if (mode === '--compare' && resultPath) {
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as Results;
    if (!validateResult(result)) throw new Error('consumer-result-schema-invalid');
    const differences = compareResults(fixture, result, fixtureSha256);
    if (differences.length) throw new Error(differences[0]);
    console.log(JSON.stringify({ status: 'passed', platform: result.platform, environment: result.environment, fixtureSha256, observations: result.observations.length }));
  } else if (!mode || mode === '--check') {
    console.log(`Rich-text behavior contract valid (${fixture.cases.length} sequences, ${fixture.compatibilityCases.length} capabilities, ${fixture.rejected.length} rejections)`);
  } else throw new Error('usage: --check | --backend | --compare result.json');
} catch (error) {
  // 只允许工具生成的机器标识；解析异常、文件内容和外部错误栈不得回显。
  const message = error instanceof Error && /^[a-zA-Z0-9_./: -]{1,240}$/.test(error.message) ? error.message : 'invalid-input';
  console.error(JSON.stringify({ status: 'failed', diagnostic: message }));
  process.exitCode = 1;
}
