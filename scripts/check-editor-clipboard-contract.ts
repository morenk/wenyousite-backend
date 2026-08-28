/** 校验 Web/Flutter 共用的编辑器剪贴板入口、节点规则和黄金用例。 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type JsonObject = Record<string, unknown>;

const fixturePath = 'contracts/editor-clipboard-v1-fixtures.json';
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureSource) as JsonObject;
const failures: string[] = [];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function uniqueIds(items: unknown[], label: string): JsonObject[] {
  const objects = items.filter(isObject);
  const ids = objects.map((item) => item.id).filter((id): id is string => typeof id === 'string');
  if (objects.length !== items.length || ids.length !== items.length || new Set(ids).size !== ids.length) {
    failures.push(`${label} 必须全部包含唯一 id`);
  }
  return objects;
}

if (fixture.contract !== 'wenyousite-editor-clipboard' || fixture.version !== 1 || fixture.markdownContractVersion !== 3) {
  failures.push('剪贴板契约标识或版本无效');
}

const envelope = isObject(fixture.webEnvelope) ? fixture.webEnvelope : {};
if (
  envelope.versionAttribute !== 'data-wenyou-clipboard' ||
  envelope.versionValue !== '1' ||
  envelope.sourceAttribute !== 'data-wenyou-clipboard-source' ||
  envelope.validation !== 'strict-allowlist' ||
  envelope.authentication !== 'none'
) {
  failures.push('Web HTML envelope 必须固定为 v1 严格白名单且不能被描述为认证边界');
}

const mobileTransport = isObject(fixture.mobileTransport) ? fixture.mobileTransport : {};
const requiredMobileMatches = Array.isArray(mobileTransport.requiredMatch)
  ? mobileTransport.requiredMatch
  : [];
if (
  mobileTransport.structuredCarrier !== 'in-process-delta' ||
  mobileTransport.systemClipboardPayload !== 'visible-text' ||
  mobileTransport.systemClipboardMarker !== 'random-per-capture' ||
  mobileTransport.maximumAgeSeconds !== 600 ||
  mobileTransport.interoperability !== 'plain-text-only' ||
  !['visible-text', 'marker', 'authenticated-session', 'maximum-age'].every((item) =>
    requiredMobileMatches.includes(item),
  )
) {
  failures.push('移动端结构载体必须固定 Delta、随机 marker、会话、十分钟有效期和纯文本互操作边界');
}

const plainTextFallback = isObject(fixture.plainTextFallback) ? fixture.plainTextFallback : {};
if (
  plainTextFallback.projection !== 'rendered-visible-text' ||
  plainTextFallback.lineEndings !== 'LF' ||
  plainTextFallback.generatedMarkdownDelimiters !== 'omit' ||
  plainTextFallback.userVisibleLiteralCharacters !== 'preserve' ||
  plainTextFallback.atomicTargetsAndHiddenIds !== 'omit'
) {
  failures.push('纯文本回退必须保留用户可见字符并移除生成的 Markdown 定界符和隐藏身份');
}

const entryPoints = uniqueIds(Array.isArray(fixture.entryPoints) ? fixture.entryPoints : [], 'entryPoints');
const actualEntries = new Set(entryPoints.map((item) =>
  `${String(item.platform)}:${String(item.surface)}:${String(item.copyMode)}:${String(item.scope)}`,
));
for (const required of [
  'web:reader-selection:structured:single-markdown-root',
  'web:reader-menu:structured:whole-content',
  'web:editor:structured:editor-selection',
  'mobile:reader-selection:visible-text:system-selection',
  'mobile:reader-menu:structured:whole-content',
  'mobile:editor:structured:editor-selection',
]) {
  if (!actualEntries.has(required)) failures.push(`缺少剪贴板入口规则 ${required}`);
}

const pasteRules = Array.isArray(fixture.pasteRules) ? fixture.pasteRules.filter(isObject) : [];
const actualPasteRules = new Set(pasteRules.map((item) => `${String(item.source)}:${String(item.result)}`));
for (const required of [
  'site-fragment-v1:structured',
  'single-valid-internal-url:internal-reference',
  'external-text-or-html:literal-text',
  'external-drop:literal-text',
  'external-file:ignore',
  'missing-invalid-or-expired-marker:visible-text',
]) {
  if (!actualPasteRules.has(required)) failures.push(`缺少粘贴规则 ${required}`);
}

const nodeRules = Array.isArray(fixture.nodeRules) ? fixture.nodeRules.filter(isObject) : [];
const byNodeType = new Map(nodeRules.map((item) => [String(item.nodeType), item]));
for (const nodeType of ['internal_reference', 'mention', 'mention_all_players', 'dice', 'image', 'sticker']) {
  if (!byNodeType.has(nodeType)) failures.push(`缺少 ${nodeType} 剪贴板节点规则`);
}
for (const mediaType of ['image', 'sticker']) {
  const rule = byNodeType.get(mediaType);
  if (rule?.readerCopy !== 'label' || rule?.editorCopy !== 'preserve') {
    failures.push(`${mediaType} 必须在阅读复制时标签化、编辑器内部复制时保留`);
  }
}
const diceRule = byNodeType.get('dice');
if (diceRule?.paste !== 'regenerate-node-id-unrolled' || diceRule?.cutPaste !== 'preserve-node-id') {
  failures.push('骰子必须复制换 ID、剪切保留 ID，且不得继承投掷结果');
}

const goldenCases = uniqueIds(Array.isArray(fixture.goldenCases) ? fixture.goldenCases : [], 'goldenCases');
const coveredKinds = new Set(goldenCases.map((item) => String(item.kind)));
for (const kind of ['reader-copy', 'external-paste', 'internal-url-paste', 'invalid-envelope']) {
  if (!coveredKinds.has(kind)) failures.push(`黄金用例缺少 ${kind}`);
}
for (const item of goldenCases) {
  if (typeof item.expectedMode !== 'string' && typeof item.expectedPlainText !== 'string') {
    failures.push(`${String(item.id)}: 必须声明 expectedMode 或 expectedPlainText`);
  }
}
const settledDiceCase = goldenCases.find((item) =>
  item.id === 'reader-settled-dice-discards-result-on-paste',
);
if (
  !settledDiceCase ||
  settledDiceCase.expectedPlainText !== '结果 2d6+1 = 11' ||
  !Array.isArray(settledDiceCase.diceRolls) ||
  !Array.isArray(settledDiceCase.expectedAtoms) ||
  !settledDiceCase.expectedAtoms.some((atom) =>
    isObject(atom) && atom.rollState === 'discard-result-on-paste' && atom.nodeId === 'regenerate',
  )
) {
  failures.push('黄金用例必须固定已结算骰子的可见结果，并在粘贴时丢弃结果和旧身份');
}

for (const sibling of ['../wenyousite-frontend', '../wenyousite-mobile']) {
  const siblingFixture = path.resolve(sibling, fixturePath);
  if (fs.existsSync(siblingFixture) && fs.readFileSync(siblingFixture, 'utf8') !== fixtureSource) {
    failures.push(`${path.basename(sibling)} 的剪贴板 v1 fixture 与事实源不一致`);
  }
}

if (failures.length > 0) {
  throw new Error(`Editor clipboard contract checks failed:\n${failures.join('\n')}`);
}
console.log(`Editor clipboard contract is valid (${entryPoints.length} entry points, ${goldenCases.length} golden cases)`);
