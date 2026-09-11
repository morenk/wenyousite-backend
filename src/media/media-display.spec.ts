import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMediaDisplay } from './media-display';

const fixture = JSON.parse(readFileSync(join(__dirname, '../../contracts/media-display-v1-fixtures.json'), 'utf8'));
const display = fixture.cases[0].display;

describe('完整展示契约', () => {
  it('保留来源身份，完整动画与静态时序有不同语义', () => {
    for (const sample of fixture.cases.filter((item: { display?: unknown }) => item.display)) {
      expect(readMediaDisplay(sample.display)).toEqual(sample.display);
    }
    expect(fixture.cases[0].expectedPersistedUrl).toBe(fixture.cases[0].sourceUrl);
    expect(fixture.cases[0].expectedDisplayUrl).not.toBe(fixture.cases[0].sourceUrl);
    expect(readMediaDisplay(null)).toBeNull();
  });
  it.each([
    { url: 'javascript:alert(1)' }, { contentType: 'image/gif' }, { width: 0 },
    { bytes: Number.MAX_SAFE_INTEGER + 1 }, { loopCount: -1 }, { durationMs: 0.5 },
    { url: 'https://secret@cdn.example.test/x.webp' },
    { animated: false }, { frameCount: 0 }, { frameCount: 1 },
  ])('拒绝未校验元数据 %j', (change) => {
    expect(readMediaDisplay({ ...display, ...change })).toBeNull();
  });
  it('只返回契约字段，不公开内部 key 或处理状态', () => {
    expect(readMediaDisplay({ ...display, key: 'internal', status: 'PENDING' })).toEqual(display);
  });
});
