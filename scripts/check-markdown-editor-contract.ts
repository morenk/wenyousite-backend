/** 校验编辑器结构化往返/字面纯文本黄金语料及客户端同步状态。 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import MarkdownIt from 'markdown-it';

type JsonObject = Record<string, unknown>;

const fixturePath = 'contracts/markdown-editor-roundtrip-v6-fixtures.json';
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureSource) as JsonObject;
const failures: string[] = [];
const markdownParser = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
});

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseBlockSemantics(markdown: string): string[] {
  const semantics: string[] = [];
  for (const token of markdownParser.parse(markdown, {})) {
    switch (token.type) {
      case 'paragraph_open':
        semantics.push('paragraph');
        break;
      case 'heading_open':
        semantics.push(`heading-${token.tag.slice(1)}`);
        break;
      case 'hr':
        semantics.push('horizontal-rule');
        break;
      case 'blockquote_open':
        semantics.push('blockquote');
        break;
      case 'bullet_list_open':
        semantics.push('bullet-list');
        break;
      case 'ordered_list_open':
        semantics.push('ordered-list');
        break;
    }
  }
  return semantics;
}

function parseInlineSemantics(markdown: string): string[] {
  const semantics: string[] = [];
  for (const token of markdownParser.parse(markdown, {})) {
    if (token.type !== 'inline' || !token.children) continue;
    for (const child of token.children) {
      switch (child.type) {
        case 'strong_open':
          semantics.push('strong');
          break;
        case 'em_open':
          semantics.push('emphasis');
          break;
        case 's_open':
          semantics.push('strikethrough');
          break;
      }
    }
  }
  return semantics;
}

function parseBlockAlignments(markdown: string): string[] {
  const lines = markdown.split('\n');
  return markdownParser
    .parse(markdown, {})
    .filter(
      (token) =>
        token.level === 0 &&
        token.map &&
        (token.type === 'paragraph_open' || token.type === 'heading_open'),
    )
    .map((token) => {
      const marker = lines[(token.map?.[0] ?? 0) - 1]?.match(
        /^\[wenyousite-align-v1-(center|right)\]: #$/u,
      );
      return marker?.[1] ?? 'left';
    });
}

if (
  fixture.contract !== 'wenyousite-markdown-editor-roundtrip' ||
  fixture.version !== 6 ||
  fixture.markdownContractVersion !== 4
) {
  failures.push('编辑器往返语料的契约标识或版本无效');
}

const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
const ids = cases
  .map((item) => (isObject(item) ? item.id : undefined))
  .filter((id): id is string => typeof id === 'string' && id.length > 0);
if (cases.length === 0 || ids.length !== cases.length || new Set(ids).size !== ids.length) {
  failures.push('case 必须存在且 id 唯一');
}

const coveredCapabilities = new Set<string>();
const coveredModes = new Set<string>();
for (const item of cases) {
  if (!isObject(item) || typeof item.id !== 'string') continue;
  if (typeof item.markdown !== 'string' || typeof item.serialized !== 'string') {
    failures.push(`${item.id}: markdown 和 serialized 必须是字符串`);
  }
  if (item.blockSemantics !== undefined) {
    if (
      !Array.isArray(item.blockSemantics) ||
      item.blockSemantics.length === 0 ||
      item.blockSemantics.some((semantic) => typeof semantic !== 'string' || semantic.length === 0)
    ) {
      failures.push(`${item.id}: blockSemantics 必须是非空字符串数组`);
    } else if (typeof item.markdown === 'string' && typeof item.serialized === 'string') {
      const expected = item.blockSemantics as string[];
      for (const [field, markdown] of [
        ['markdown', item.markdown],
        ['serialized', item.serialized],
      ] as const) {
        const actual = parseBlockSemantics(markdown);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          failures.push(
            `${item.id}: ${field} 块语义应为 ${expected.join(', ')}，实际为 ${actual.join(', ')}`,
          );
        }
      }
    }
  }
  if (item.inlineSemantics !== undefined) {
    if (
      !Array.isArray(item.inlineSemantics) ||
      item.inlineSemantics.length === 0 ||
      item.inlineSemantics.some(
        (semantic) =>
          semantic !== 'strong' && semantic !== 'emphasis' && semantic !== 'strikethrough',
      )
    ) {
      failures.push(
        `${item.id}: inlineSemantics 必须是只含 strong、emphasis 或 strikethrough 的非空数组`,
      );
    } else if (typeof item.serialized === 'string') {
      const expected = item.inlineSemantics as string[];
      const actual = parseInlineSemantics(item.serialized);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(
          `${item.id}: serialized 行内语义应为 ${expected.join(', ')}，实际为 ${actual.join(', ')}`,
        );
      }
    }
  }
  if (item.blockAlignments !== undefined) {
    if (
      !Array.isArray(item.blockAlignments) ||
      item.blockAlignments.length === 0 ||
      item.blockAlignments.some(
        (alignment) => alignment !== 'left' && alignment !== 'center' && alignment !== 'right',
      )
    ) {
      failures.push(`${item.id}: blockAlignments 必须是只含 left、center 或 right 的非空数组`);
    } else if (typeof item.markdown === 'string' && typeof item.serialized === 'string') {
      const expected = item.blockAlignments as string[];
      for (const [field, markdown] of [
        ['markdown', item.markdown],
        ['serialized', item.serialized],
      ] as const) {
        const actual = parseBlockAlignments(markdown);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          failures.push(
            `${item.id}: ${field} 块对齐应为 ${expected.join(', ')}，实际为 ${actual.join(', ')}`,
          );
        }
      }
    }
  }
  if (item.mode !== 'structured' && item.mode !== 'literal-text') {
    failures.push(`${item.id}: mode 必须是 structured 或 literal-text`);
  } else {
    coveredModes.add(item.mode);
  }
  if (!Array.isArray(item.capabilities) || item.capabilities.length === 0) {
    failures.push(`${item.id}: capabilities 必须是非空数组`);
    continue;
  }
  for (const capability of item.capabilities) {
    if (typeof capability !== 'string' || capability.length === 0) {
      failures.push(`${item.id}: capability 必须是非空字符串`);
    } else {
      coveredCapabilities.add(capability);
    }
  }
}

for (const capability of [
  'bold',
  'soft-break',
  'italic',
  'strikethrough',
  'inline-code',
  'link',
  'heading',
  'alignment',
  'quote',
  'bullet-list',
  'ordered-list',
  'hr',
  'task-list',
  'code-block',
  'table',
]) {
  if (!coveredCapabilities.has(capability)) failures.push(`缺少 ${capability} 编辑器样例`);
}
for (const mode of ['structured', 'literal-text']) {
  if (!coveredModes.has(mode)) failures.push(`缺少 ${mode} 模式样例`);
}

const horizontalRuleCase = cases.find((item) => isObject(item) && item.id === 'horizontal-rule');
if (
  !isObject(horizontalRuleCase) ||
  horizontalRuleCase.markdown !== '正文\n\n---\n\n正文' ||
  horizontalRuleCase.serialized !== '正文\n\n---\n\n正文' ||
  !Array.isArray(horizontalRuleCase.blockSemantics) ||
  !horizontalRuleCase.blockSemantics.includes('horizontal-rule')
) {
  failures.push('horizontal-rule 必须使用空行分隔的规范写法并断言 horizontal-rule 块语义');
}

const setextHeadingCase = cases.find((item) => isObject(item) && item.id === 'setext-heading-2');
if (
  !isObject(setextHeadingCase) ||
  setextHeadingCase.markdown !== '正文\n---' ||
  setextHeadingCase.serialized !== '## 正文' ||
  JSON.stringify(setextHeadingCase.blockSemantics) !== JSON.stringify(['heading-2'])
) {
  failures.push('setext-heading-2 必须保留历史 Setext H2 语义并规范为 ATX H2');
}

for (const requiredId of [
  'attention-boundary-bold-live-content',
  'attention-boundary-italic',
  'attention-boundary-nested-emphasis',
  'attention-boundary-strikethrough',
  'attention-boundary-underscore-italic',
  'attention-boundary-underscore-bold',
  'attention-boundary-underscore-nested',
]) {
  const boundaryCase = cases.find((item) => isObject(item) && item.id === requiredId);
  if (
    !isObject(boundaryCase) ||
    boundaryCase.mode !== 'structured' ||
    !Array.isArray(boundaryCase.inlineSemantics) ||
    boundaryCase.inlineSemantics.length === 0
  ) {
    failures.push(`${requiredId} 必须声明 structured 模式和 inlineSemantics`);
  }
}

for (const requiredId of ['aligned-paragraphs', 'aligned-headings']) {
  const alignmentCase = cases.find((item) => isObject(item) && item.id === requiredId);
  if (
    !isObject(alignmentCase) ||
    alignmentCase.mode !== 'structured' ||
    !Array.isArray(alignmentCase.blockAlignments) ||
    alignmentCase.blockAlignments.length === 0
  ) {
    failures.push(`${requiredId} 必须声明 structured 模式和 blockAlignments`);
  }
}

for (const client of ['wenyousite-frontend', 'wenyousite-mobile']) {
  const clientFixture = path.resolve(`../${client}`, fixturePath);
  if (fs.existsSync(clientFixture) && fs.readFileSync(clientFixture, 'utf8') !== fixtureSource) {
    failures.push(`${client} 的编辑器往返语料与后端不一致`);
  }
}

if (failures.length > 0) {
  throw new Error(`Markdown editor contract checks failed:\n${failures.join('\n')}`);
}
console.log(`Markdown editor contract is valid (${cases.length} cases)`);
