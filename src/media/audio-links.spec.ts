import { extractMarkdownAudioLinks } from './audio-links';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const fixtures = JSON.parse(
  readFileSync(resolve('contracts/markdown-audio-v1-fixtures.json'), 'utf8'),
) as { cases: { id: string; markdown: string; mediaAudios: { sourceUrl: string }[] }[] };

describe('音频普通链接 AST', () => {
  for (const fixture of fixtures.cases) {
    it(fixture.id, () => {
      const urls = extractMarkdownAudioLinks(fixture.markdown);
      if (['code', 'escaped', 'external'].includes(fixture.id)) expect(urls).toEqual([]);
      else expect(urls).toEqual([fixtures.cases[0].mediaAudios[0].sourceUrl]);
    });
  }
  it('多行代码、转义和图片均不能伪造资源引用', () => {
    const url = fixtures.cases[0].mediaAudios[0].sourceUrl;
    expect(extractMarkdownAudioLinks('`正文\n[音频](' + url + ')`')).toEqual([]);
    expect(extractMarkdownAudioLinks('![音频](' + url + ')')).toEqual([]);
    expect(extractMarkdownAudioLinks('```\n[音频](' + url + ')\n```')).toEqual([]);
  });
});
