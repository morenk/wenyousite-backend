import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatInternalReferencePreview,
  parseInternalReference,
} from './internal-reference';

type Fixture = {
  cases: Array<{
    id: string;
    input: string;
    recognized: boolean;
    kind?: string;
    canonical?: string;
  }>;
  renderingCases: Array<{
    id: string;
    source: string;
    visibleText: string;
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../contracts/internal-reference-v1-fixtures.json'),
    'utf8',
  ),
) as Fixture;

describe('internal reference contract', () => {
  it.each(fixture.cases)('$id', ({ input, recognized, kind, canonical }) => {
    const parsed = parseInternalReference(input);
    expect(!!parsed).toBe(recognized);
    if (recognized) {
      expect(parsed?.kind).toBe(kind);
      expect(parsed?.href).toBe(canonical);
    }
  });

  it.each(fixture.renderingCases)('$id preview', ({ source, visibleText }) => {
    expect(formatInternalReferencePreview(source)).toBe(visibleText);
  });
});
