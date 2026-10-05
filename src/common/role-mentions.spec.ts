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
  it('未闭合/长度不同的反引号不是代码，不能绕过目标校验', () => {
    const invalid = '[@伪造](/users/user?rpIdentityId=invalid)';
    expect(() => parseMentionSources('` ' + invalid + ' ``', true)).toThrow();
    expect(() => parseMentionSources('\\` ' + invalid + ' `', true)).toThrow();
    expect(parseMentionSources('`` ' + invalid + ' ``', true)).toEqual([]);
  });
  it('跨行/引用/列表/缩进代码及图片标签不产生提及，emoji不改变源偏移', () => {
    const source = fixture.cases[0].source;
    for (const example of ['`前\n' + source + '\n后`', '> ```\n> ' + source + '\n> ```', '- ```\n  ' + source + '\n  ```', '    ' + source, '!' + source])
      expect(parseMentionSources(example, true)).toEqual([]);
    expect(parseMentionSources('😀 > ' + source, true)).toEqual([expect.objectContaining({start:5, end:5+source.length})]);
    expect(parseMentionSources('`未闭合\n\n' + source, true)).toHaveLength(1);
    expect(parseMentionSources('> ' + source, true)).toHaveLength(1);
  });
  it('原子标签内反引号保留原值，外层代码仍遮蔽整个提及', () => {
    const href = parseMentionSources(fixture.cases[0].source)[0].sourceHref;
    for (const label of ['白`鸦`', '白`鸦', '*白鸦*']) {
      const source = `[@${label}](${href})`;
      expect(parseMentionSources(source + ' 外层 `代码`', true)).toEqual([expect.objectContaining({label, sourceHref:href})]);
      expect(parseMentionSources('`` ' + source + ' ``', true)).toEqual([]);
    }
    expect(() => parseMentionSources('[@白`鸦`](/users/user?rpIdentityId=bad)', true)).toThrow();
  });
  it('降级副本不会携带角色目标或旧别名', () => {
    const token = parseMentionSources(fixture.cases[0].source)[0];
    expect(accountMentionFallback(fixture.cases[0].source, new Map([[token.userId,'账号']]))).toBe(`[@账号](/users/${token.userId})`);
    expect(parseMentionSources(fixture.cases[0].source)[0].targetIdentityId).toBe(token.targetIdentityId);
  });
});
