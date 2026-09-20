import { withResources } from './e2e-resources';
void withResources(async (r) => {
  await r.verify();
  console.log(JSON.stringify({ root: r.root, runId: r.runId }));
  await new Promise(() => undefined);
}).catch(() => { process.exitCode = 1; });
