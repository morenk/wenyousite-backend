import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatDirectMessagePreview,
  formatInternalReferencePreview,
  INTERNAL_REFERENCE_DEFAULT_LABEL,
  parseInternalReference,
  serializeInternalReference,
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
  editorPasteCases: Array<{
    id: string;
    clipboardText: string;
    selectedText: string;
    handled: boolean;
    kind?: string;
    canonical?: string;
    label?: string;
    serialized?: string;
  }>;
  directMessagePreviewCases: Array<{
    id: string;
    source: string;
    preview: string;
  }>;
};

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/internal-reference-v1-fixtures.json'), 'utf8'),
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

  it.each(fixture.editorPasteCases)(
    '$id editor paste',
    ({ clipboardText, selectedText, handled, kind, canonical, label, serialized }) => {
      const parsed = parseInternalReference(clipboardText.trim());
      expect(!!parsed).toBe(handled);
      if (!handled) return;

      expect(parsed?.kind).toBe(kind);
      expect(parsed?.href).toBe(canonical);
      const resolvedLabel = selectedText.trim() || INTERNAL_REFERENCE_DEFAULT_LABEL;
      expect(resolvedLabel).toBe(label);
      expect(serializeInternalReference(resolvedLabel, parsed?.href ?? '')).toBe(serialized);
    },
  );

  it.each(fixture.directMessagePreviewCases)('$id direct message preview', ({ source, preview }) => {
    expect(formatDirectMessagePreview(source)).toBe(preview);
  });
});
