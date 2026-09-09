import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { canonicalize, assessCapability, equal, summarize, validSelection, type Summary, type Inline } from './semantics';
import { backendResults, checkpoints, compareResults, loadContract, validateContract } from './validation';
const contract = loadContract();
const { fixture, fixtureSha256, validateResult } = contract;

test('独立作者预期：全部结构、选区、能力和服务端拒绝一致', () => {
  assert.deepEqual(validateContract(fixture), []);
});
test('规范化反复保存不改变正文；历史 LF 只保留结构不猜按键', () => {
  assert.equal(canonicalize('甲\r\n<br/>\r\n乙'), '甲\n<br />\n乙');
  assert.notDeepEqual(summarize('甲\n乙'), summarize('甲\n\n乙'));
  assert.notDeepEqual(summarize('甲\n\n乙'), summarize('甲\n<br />\n乙'));
  assert.notDeepEqual(summarize('> 甲\n>\n> 乙'), summarize('> 甲\n> <br />\n> 乙'));
  for (const point of checkpoints(fixture)) if (point.expected.canonical !== null) {
    let value = point.expected.canonical;
    for (let index = 0; index < 5; index++) value = canonicalize(value);
    assert.equal(value, point.expected.canonical);
  }
});
test('复用 v7 全部 48 条样式组合的独立 expected marks 和文字', () => {
  const existing = JSON.parse(readFileSync('contracts/markdown-editor-roundtrip-v7-fixtures.json', 'utf8'));
  for (const item of existing.editCases) {
    const summary = summarize(item.serialized);
    assert.deepEqual(summary, { blocks: [{ type: 'paragraph', alignment: 'left', children: [{ type: 'text', text: item.visibleText, marks: item.operation.marks }] }] }, item.id);
  }
});
test('原子节点语料复用服务端身份，转义和代码中的相同标记不创建身份', () => {
  const existing = JSON.parse(readFileSync('contracts/markdown-v4-nodes-fixtures.json', 'utf8'));
  for (const item of existing.cases) {
    const summary = summarize(item.markdown);
    const atoms: unknown[] = [];
    const walk = (nodes: Array<Record<string, unknown>>) => {
      for (const node of nodes) {
        if (['dice', 'mention', 'mentionAll', 'sticker', 'image'].includes(String(node.type))) atoms.push(node);
        if (Array.isArray(node.children)) walk(node.children);
      }
    };
    walk(summary.blocks as unknown as Array<Record<string, unknown>>);
    const expected = item.nodes.map((node: Record<string, unknown>) => ({ ...node, type: node.type === 'mention_all_players' ? 'mentionAll' : node.type }));
    assert.deepEqual(atoms, expected, item.id);
  }
});
test('结构丢失、marks 或原子身份改变可被摘要发现，不以白名单通过代替无损', () => {
  assert.equal(equal(summarize('**甲**'), summarize('甲')), false);
  assert.equal(equal(summarize('[@甲](/users/user-a)'), summarize('[@甲](/users/user-b)')), false);
  const first = fixture.cases.find((item) => item.id === 'rtb-dice-copy-undo')!;
  assert.equal(equal(first.initial.summary, first.steps[1].expected.summary), false);
});
test('能力缺失与未知结构不能借其他文字编辑覆盖原内容；旧版本矩阵不是运行 APK 证明', () => {
  for (const item of fixture.compatibilityCases) assert.deepEqual(assessCapability(item.markdown, fixture.profiles[item.profile], item.lossless), item.expected);
  for (const original of ['甲 [[widget:v9:future]]', '甲 <span>乙</span>']) {
    const copy = original;
    assert.equal(assessCapability(original, fixture.profiles['candidate-v5'], true).edit, false);
    assert.equal(original, copy);
    assert.throws(() => canonicalize(original));
  }
  assert.equal(assessCapability('> 甲\n> <br />\n> 乙', fixture.profiles['legacy-v5'], true).edit, false);
  assert.equal(assessCapability('甲\n乙', fixture.profiles['legacy-v3'], true).edit, true);
});
test('选区使用明确路径并保留 UTF-16 与原子宽度；越界不能蒙混过关', () => {
  const summary = summarize('甲👩‍💻乙');
  assert.equal(validSelection(summary, { anchor: { path: [0], offset: 6 }, focus: { path: [0], offset: 7 } }), true);
  assert.equal(validSelection(summary, { anchor: { path: [1], offset: 0 }, focus: { path: [0], offset: 8 } }), false);
});
test('后端合成回执可复核，不声称执行客户端输入或关闭', () => {
  const result = backendResults(fixture, fixtureSha256, 'a'.repeat(40));
  assert.equal(validateResult(result), true);
  assert.deepEqual(compareResults(fixture, result, fixtureSha256), []);
  assert.equal(result.environment, 'offline');
  assert.ok(result.observations.some((item) => item.status === 'not-run'));
});
test('篡改摘要、伪 passed、缺结果、重复、未知用例和过期 fixture 均不能通过', () => {
  const clean = () => backendResults(fixture, fixtureSha256, 'a'.repeat(40));
  const altered = clean();
  ((altered.observations[0].actual!.summary as Summary).blocks[0].children![0] as Inline).text = 'SECRET-SYNTHETIC-SENTINEL';
  const errors = compareResults(fixture, altered, fixtureSha256);
  assert.ok(errors[0].includes('/summary/blocks/0/children/0/text'));
  assert.ok(!errors.join('').includes('SECRET-SYNTHETIC-SENTINEL'));
  const missing = clean(); missing.observations.pop();
  assert.ok(compareResults(fixture, missing, fixtureSha256).some((item) => item.endsWith('missing-observation')));
  const duplicate = clean(); duplicate.observations.push(duplicate.observations[0]);
  assert.ok(compareResults(fixture, duplicate, fixtureSha256).some((item) => item.endsWith('duplicate-observation')));
  const unknown = clean(); unknown.observations[0].caseId = 'SECRET-SYNTHETIC-SENTINEL';
  assert.equal(compareResults(fixture, unknown, fixtureSha256)[0], 'unknown-case-or-step');
  assert.deepEqual(compareResults(fixture, clean(), '0'.repeat(64)), ['fixture-hash-mismatch']);
  const client = clean(); client.platform = 'web';
  assert.ok(compareResults(fixture, client, fixtureSha256).some((item) => item.includes('selection:missing-observation')));
});
test('客户端完整阶段对照检查 save/close 原值保护，错误路径不得被摘要正确掩盖', () => {
  // 此处仅测试结果比较器；不是消费者执行证据，结果不导出或标注真机验收。
  const result = backendResults(fixture, fixtureSha256, 'a'.repeat(40));
  result.platform = 'web'; result.environment = 'unit-editor'; result.observations = [];
  for (const point of checkpoints(fixture)) {
    for (const stage of [point.stepId === 'initial' ? 'decoded' : 'edited', 'serialized', 'reader', ...(point.expected.selection ? ['selection'] : []), ...(point.expected.save ? ['save'] : [])]) {
      result.observations.push({ caseId: point.caseId, stepId: point.stepId, stage, status: 'passed', actual: structuredClone(point.expected) });
    }
  }
  assert.deepEqual(compareResults(fixture, result, fixtureSha256), []);
  for (const observation of result.observations) if (observation.actual?.save && !observation.actual.save.target) observation.actual.save.target = 'server';
  assert.deepEqual(compareResults(fixture, result, fixtureSha256), []);
  const close = result.observations.find((item) => item.caseId === 'rtb-close-encode-error' && item.stepId === 'close-failed' && item.stage === 'save')!;
  close.actual!.navigation = 'close';
  assert.ok(compareResults(fixture, result, fixtureSha256)[0].endsWith('/navigation'));
});
