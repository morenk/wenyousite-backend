import * as fs from 'node:fs';
import {
  formatInternalReferencePreview,
  INTERNAL_REFERENCE_DEFAULT_LABEL,
  parseInternalReference,
} from '../src/common/internal-reference';

type ReferenceCase = {
  id: string;
  input: string;
  recognized: boolean;
  kind?: string;
  canonical?: string;
};

type RenderingCase = {
  id: string;
  source: string;
  visibleText: string;
  portalCount: number;
};

type EditorPasteCase = {
  id: string;
  clipboardText: string;
  selectedText: string;
  handled: boolean;
  kind?: string;
  canonical?: string;
  label?: string;
  serialized?: string;
};

type Fixture = {
  contract: string;
  version: number;
  productionOrigin: string;
  defaultLabel: string;
  cases: ReferenceCase[];
  renderingCases: RenderingCase[];
  editorPasteCases: EditorPasteCase[];
};

const fixture = JSON.parse(
  fs.readFileSync('contracts/internal-reference-v1-fixtures.json', 'utf8'),
) as Fixture;
const failures: string[] = [];

if (fixture.contract !== 'wenyousite-internal-reference' || fixture.version !== 1) {
  failures.push('协议标识或版本不是 wenyousite-internal-reference v1');
}
if (fixture.productionOrigin !== 'https://wenyou.site') {
  failures.push('productionOrigin 必须固定为 https://wenyou.site');
}
if (fixture.defaultLabel !== INTERNAL_REFERENCE_DEFAULT_LABEL) {
  failures.push('defaultLabel 与运行时默认名称不一致');
}

for (const testCase of fixture.cases) {
  const parsed = parseInternalReference(testCase.input);
  if (!!parsed !== testCase.recognized) {
    failures.push(`${testCase.id}: recognized 与运行时不一致`);
    continue;
  }
  if (parsed && (parsed.kind !== testCase.kind || parsed.href !== testCase.canonical)) {
    failures.push(`${testCase.id}: kind 或 canonical 与运行时不一致`);
  }
}

for (const testCase of fixture.renderingCases) {
  if (formatInternalReferencePreview(testCase.source) !== testCase.visibleText) {
    failures.push(`${testCase.id}: visibleText 与运行时不一致`);
  }
  if (!Number.isInteger(testCase.portalCount) || testCase.portalCount < 0) {
    failures.push(`${testCase.id}: portalCount 必须是非负整数`);
  }
}

for (const testCase of fixture.editorPasteCases) {
  const parsed = parseInternalReference(testCase.clipboardText.trim());
  if (!!parsed !== testCase.handled) {
    failures.push(`${testCase.id}: handled 与解析结果不一致`);
    continue;
  }
  if (!parsed) continue;
  const label = testCase.selectedText.trim() || INTERNAL_REFERENCE_DEFAULT_LABEL;
  const serialized = `[${label}](${parsed.href})`;
  if (
    parsed.kind !== testCase.kind ||
    parsed.href !== testCase.canonical ||
    label !== testCase.label ||
    serialized !== testCase.serialized
  ) {
    failures.push(`${testCase.id}: 粘贴规范化结果不一致`);
  }
}

const allCases = [...fixture.cases, ...fixture.renderingCases, ...fixture.editorPasteCases];
if (new Set(allCases.map((item) => item.id)).size !== allCases.length) {
  failures.push('全部 case id 必须存在且唯一');
}
for (const requiredId of [
  'invite-relative',
  'invite-absolute',
  'invite-invalid-token',
  'invite-query-not-allowed',
  'bare-invite',
  'paste-invite-absolute-default-label',
  'paste-invite-relative-selected-label',
  'paste-mixed-text-falls-through',
]) {
  if (!allCases.some((item) => item.id === requiredId)) {
    failures.push(`缺少邀请传送门必需用例 ${requiredId}`);
  }
}

if (failures.length > 0) {
  throw new Error(`站内传送门契约检查失败：\n${failures.join('\n')}`);
}
console.log(`Internal reference contract is valid (${allCases.length} cases)`);
