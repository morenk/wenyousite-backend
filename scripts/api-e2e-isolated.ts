import { run } from './e2e-runner';
void run(['--api', ...process.argv.slice(2)]).catch(() => {
  console.error('隔离 API E2E 失败；禁止回退到线上地址');
  process.exitCode = 1;
});
