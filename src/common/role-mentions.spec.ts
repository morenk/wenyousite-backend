import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMentionSources, assertRoleMentionWrite, accountMentionFallback } from './role-mentions';
const fixture = JSON.parse(readFileSync(join(__dirname, '../../contracts/markdown-v6-role-mentions-fixtures.json'), 'utf8')) as {
  cases: Array<{id:string;source:string;expected:Array<Record<string, unknown>>}>;
  invalidSources:string[]; writeCases:Array<{id:string;content:string;previous?:string;version?:number;enabled:boolean;expectedCode:number|null}>;
};
describe('Markdown6 角色提及固定语料', () => {
  for (const row of fixture.cases) it(row.id, () => {
    const parsed = parseMentionSources(row.source, true);
    expect(parsed).toHaveLength(row.expected.length);
    row.expected.forEach((target, index) => expect(parsed[index]).toMatchObject(target));
  });
  for (const source of fixture.invalidSources) it(`拒绝 ${source}`, () => expect(() => parseMentionSources(source, true)).toThrow());
  for (const row of fixture.writeCases) it(row.id, () => {
    const action = () => assertRoleMentionWrite(row.content, row.previous, row.version, row.enabled);
    if (row.expectedCode) expect(action).toThrow(expect.objectContaining({errorCode:row.expectedCode}));
    else expect(action).not.toThrow();
  });
  it('降级副本不会携带角色目标或旧别名', () => {
    const token = parseMentionSources(fixture.cases[0].source)[0];
    expect(accountMentionFallback(fixture.cases[0].source, new Map([[token.userId,'账号']]))).toBe(`[@账号](/users/${token.userId})`);
    expect(parseMentionSources(fixture.cases[0].source)[0].targetIdentityId).toBe(token.targetIdentityId);
  });
});
