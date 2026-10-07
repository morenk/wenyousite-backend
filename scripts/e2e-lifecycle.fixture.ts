import { withResources } from './e2e-resources';
void withResources(async (r) => {
  await r.verify();
  const ready = JSON.stringify({ event: 'lifecycle-ready', root: r.root, runId: r.runId });
  // 同一 chunk 包含完整进度行和半条身份，后续 chunk 再补齐；消费者不能假定单 JSON。
  process.stdout.write(JSON.stringify({ event: 'lifecycle-progress' }) + '\n' + ready.slice(0, 12));
  setImmediate(() => process.stdout.write(ready.slice(12) + '\n'));
  await new Promise(() => undefined);
}).catch(() => { process.exitCode = 1; });
