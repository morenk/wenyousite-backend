import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { canonicalize, equal, summarize, assessCapability, validSelection, type Fixture, type Snapshot } from './semantics';

export const FIXTURE_PATH = 'contracts/rich-text-behavior-v1-fixtures.json';
export function loadContract(root = process.cwd()) {
  const source = readFileSync(resolve(root, FIXTURE_PATH), 'utf8');
  const schema = JSON.parse(readFileSync(resolve(root, 'contracts/rich-text-behavior-v1.schema.json'), 'utf8'));
  const resultsSchema = JSON.parse(readFileSync(resolve(root, 'contracts/rich-text-behavior-results-v1.schema.json'), 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema(schema);
  const validateResult = ajv.compile(resultsSchema);
  const fixture = JSON.parse(source) as Fixture;
  if (!ajv.validate(schema, fixture)) throw new Error('fixture-schema-invalid');
  return { fixture, validateResult, fixtureSha256: createHash('sha256').update(source).digest('hex') };
}
export function checkpoints(fixture: Fixture) {
  return fixture.cases.flatMap((item) => [
    { caseId: item.id, stepId: 'initial', operation: undefined, expected: item.initial },
    ...item.steps.map((step) => ({ caseId: item.id, stepId: step.id, operation: step.operation, expected: step.expected })),
  ]);
}
export function validateContract(fixture: Fixture): string[] {
  const failures: string[] = [];
  const ids = new Set<string>();
  for (const item of fixture.cases) {
    if (ids.has(item.id)) failures.push(`${item.id}:duplicate-case`);
    ids.add(item.id);
    const steps = new Set(['initial']);
    for (const step of item.steps) {
      if (steps.has(step.id)) failures.push(`${item.id}:duplicate-step`);
      steps.add(step.id);
    }
  }
  for (const point of checkpoints(fixture)) {
    const { expected, caseId, stepId } = point;
    const key = `${caseId}/${stepId}`;
    if (expected.selection && !validSelection(expected.summary, expected.selection)) failures.push(`${key}:selection-bounds`);
    if (expected.canonical !== null) {
      try {
        const canonical = canonicalize(expected.canonical);
        if (canonical !== expected.canonical || canonicalize(canonical) !== canonical) failures.push(`${key}:canonical`);
        if (!equal(summarize(canonical), expected.summary)) failures.push(`${key}:independent-summary`);
      } catch { failures.push(`${key}:backend-rejected`); }
    }
  }
  for (const item of fixture.compatibilityCases) {
    if (!equal(assessCapability(item.markdown, fixture.profiles[item.profile], item.lossless), item.expected)) failures.push(`${item.id}:capability`);
  }
  for (const item of fixture.rejected) {
    let code: unknown;
    try { canonicalize(item.markdown); } catch (error) { code = (error as { errorCode?: number }).errorCode; }
    if (code !== item.errorCode) failures.push(`${item.id}:rejection-code`);
  }
  return failures;
}
export interface Observation {
  caseId: string; stepId: string; stage: string; status: 'passed' | 'failed' | 'not-run'; actual?: Snapshot; reason?: string;
}
export interface Results {
  contract: string; version: number; fixtureSha256: string; sourceRevision: string; platform: string; environment: string; observations: Observation[];
}
export function backendResults(fixture: Fixture, fixtureSha256: string, sourceRevision: string): Results {
  return { contract: 'wenyousite-rich-text-behavior-results', version: 1, fixtureSha256, sourceRevision,
    platform: 'backend', environment: 'offline', observations: checkpoints(fixture).map((point): Observation => {
      if (point.expected.canonical === null) return { caseId: point.caseId, stepId: point.stepId, stage: 'backend', status: 'not-run', reason: 'not-applicable' };
      const canonical = canonicalize(point.expected.canonical);
      return { caseId: point.caseId, stepId: point.stepId, stage: 'backend', status: 'passed', actual: { canonical, summary: summarize(canonical) } };
    }) };
}
function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (equal(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}/length`;
    for (let i = 0; i < a.length; i++) { const diff = firstDifference(a[i], b[i], `${path}/${i}`); if (diff) return diff; }
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const diff = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`);
      if (diff) return diff;
    }
  }
  return path || '/';
}
function isNotApplicable(point: ReturnType<typeof checkpoints>[number], platform: string, stage: string): boolean {
  // Web 关闭是丢弃确认，不执行移动端本机快照；只豁免该用例的 close 操作，保留初始化/输入实测。
  if (platform === 'web' && point.caseId === 'rtb-close-encode-error'
    && point.operation?.type === 'close' && point.expected.save?.target === 'local-snapshot'
    && ['edited', 'serialized', 'reader', 'selection', 'save'].includes(stage)) return true;
  // 编码失败必须观测 serialized=null 和保存保护；此时没有当前正文供阅读或后端校验。
  return point.expected.canonical === null && (stage === 'backend'
    || (['web', 'flutter'].includes(platform) && stage === 'reader'));
}
export function compareResults(fixture: Fixture, results: Results, fixtureSha256: string): string[] {
  if (results.fixtureSha256 !== fixtureSha256) return ['fixture-hash-mismatch'];
  const points = checkpoints(fixture);
  const byId = new Map(points.map((point) => [`${point.caseId}/${point.stepId}`, point]));
  const seen = new Set<string>();
  const failures: string[] = [];
  for (const obs of results.observations) {
    const pointId = `${obs.caseId}/${obs.stepId}`;
    const point = byId.get(pointId);
    if (!point) { failures.push('unknown-case-or-step'); continue; }
    const { expected } = point;
    const key = `${pointId}/${obs.stage}`;
    if (seen.has(key)) { failures.push(`${key}:duplicate-observation`); continue; }
    seen.add(key);
    if (isNotApplicable(point, results.platform, obs.stage)) {
      if (obs.status !== 'not-run' || obs.reason !== 'not-applicable' || obs.actual !== undefined) failures.push(`${key}:invalid-not-applicable`);
      continue;
    }
    if (obs.status === 'not-run') { failures.push(`${key}:not-run`); continue; }
    if (!obs.actual || obs.status !== 'passed') { failures.push(`${key}:failed-or-missing-actual`); continue; }
    const fields: Array<keyof Snapshot> = obs.stage === 'selection' ? ['selection'] : obs.stage === 'save' ? ['save', 'navigation']
      : obs.stage === 'serialized' ? ['canonical'] : obs.stage === 'backend' ? ['canonical', 'summary'] : ['summary'];
    for (const field of fields) {
      if (!(field in expected)) continue;
      const wanted = field === 'save' && expected.save ? { target: 'server', ...expected.save } : expected[field];
      const actual = field === 'save' && obs.actual.save ? { target: 'server', ...obs.actual.save } : obs.actual[field];
      const diff = firstDifference(wanted, actual, `/${field}`);
      if (diff) { failures.push(`${key}:${diff}`); break; }
    }
  }
  for (const point of points) {
    const key = `${point.caseId}/${point.stepId}`;
    const required = results.platform === 'backend' ? ['backend'] : [point.stepId === 'initial' ? 'decoded' : 'edited', 'serialized', 'reader',
      ...(point.expected.selection ? ['selection'] : []), ...(point.expected.save ? ['save'] : [])];
    for (const stage of required) if (!seen.has(`${key}/${stage}`)) failures.push(`${key}/${stage}:missing-observation`);
  }
  return failures;
}
