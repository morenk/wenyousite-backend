import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv/dist/2020';
import { TEXT_FONT_IDS } from '../src/common/text-font-catalog';
import { parseTextFonts, stripTextStyles } from '../src/common/text-colors';
import { prepareMarkdownContent } from '../src/common/markdown-content';

const read = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../contracts', name), 'utf8'));
const schema = read('markdown-text-font-v1.schema.json');
const fixture = read('markdown-text-font-v1-fixtures.json');
const catalog = read('thread-font-catalog-v1.json');
const validate = new Ajv({ allErrors: true }).compile(schema);
assert.deepEqual([...TEXT_FONT_IDS].sort(), [...schema.properties.fontId.enum].sort());
assert.deepEqual(
  [...TEXT_FONT_IDS].sort(),
  catalog.fonts.map((font: { id: string }) => font.id).sort(),
);
assert.equal(new Set(TEXT_FONT_IDS).size, 29);
for (const row of fixture.validCases) {
  assert.equal(
    prepareMarkdownContent(row.source, { textFontVersion: 1, textColorVersion: 1 }),
    row.canonical,
    row.id,
  );
  for (const range of parseTextFonts(row.canonical)) {
    assert(
      validate({
        version: 1,
        fontId: range.fontId,
        content: range.content,
        ...(range.color ? { color: range.color } : {}),
      }),
      row.id,
    );
  }
  assert.equal(stripTextStyles(row.source), row.legacy, row.id);
}
console.log('Text font schema, catalog identities and shared fixtures are consistent');
